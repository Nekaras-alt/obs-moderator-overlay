#include "omo-tcp-frames.hpp"
#include "http-local.hpp"

#include <cstring>
#include <cstdio>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <fcntl.h>
using SOCKET = int;
#define INVALID_SOCKET (-1)
#define SOCKET_ERROR (-1)
#define closesocket close
#endif

static const uint32_t OMOF_MAGIC = 0x4f4d4f46u;
static const size_t OMOF_HEADER = 24;

/*
 * TODO(SHM): Prefer Win32 named shared memory (e.g. Local\OMOFrame_<port>) with
 * a small header + BGRA ring buffer published by Electron frame-bridge, falling
 * back to this TCP OMOF path when the mapping is missing. Keep TCP as the
 * reliable default until SHM producer/consumer handshake is implemented.
 */

static bool recv_all(SOCKET s, uint8_t *dst, int len)
{
	int got = 0;
	while (got < len) {
		int n = recv(s, (char *)dst + got, len - got, 0);
		if (n <= 0)
			return false;
		got += n;
	}
	return true;
}

static SOCKET connect_local(uint16_t port)
{
	SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (s == INVALID_SOCKET)
		return INVALID_SOCKET;
#ifdef _WIN32
	BOOL nd = TRUE;
	setsockopt(s, IPPROTO_TCP, TCP_NODELAY, (const char *)&nd, sizeof(nd));
#else
	int nd = 1;
	setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &nd, sizeof(nd));
#endif
	sockaddr_in addr{};
	addr.sin_family = AF_INET;
	addr.sin_port = htons(port);
	inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
#ifdef _WIN32
	u_long nb = 0;
	ioctlsocket(s, FIONBIO, &nb);
#else
	int flags = fcntl(s, F_GETFL, 0);
	fcntl(s, F_SETFL, flags & ~O_NONBLOCK);
#endif
	if (connect(s, (sockaddr *)&addr, sizeof(addr)) == SOCKET_ERROR) {
		closesocket(s);
		return INVALID_SOCKET;
	}
	return s;
}

static void *reader_thread(void *data)
{
	OmoTcpFrames *ctx = (OmoTcpFrames *)data;
#ifdef _WIN32
	WSADATA wsa;
	WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

	while (!ctx->stop.load()) {
		ctx->tcpConnected.store(false);
		SOCKET s = connect_local(ctx->framePort);
		if (s == INVALID_SOCKET) {
			os_sleep_ms(ctx->reconnectMs);
			if (ctx->reconnectMs < 2000u)
				ctx->reconnectMs = ctx->reconnectMs < 1000u ? ctx->reconnectMs + 200u : 2000u;
			continue;
		}
		ctx->reconnectMs = 200;
		ctx->tcpConnected.store(true);
		blog(LOG_INFO, "[omo-connector] frame client connected :%u", (unsigned)ctx->framePort);

		while (!ctx->stop.load()) {
			uint8_t hdr[OMOF_HEADER];
			if (!recv_all(s, hdr, (int)OMOF_HEADER))
				break;

			uint32_t magic = (uint32_t(hdr[0]) << 24) | (uint32_t(hdr[1]) << 16) |
					 (uint32_t(hdr[2]) << 8) | uint32_t(hdr[3]);
			if (magic != OMOF_MAGIC)
				break;

			uint16_t width = (uint16_t(hdr[6]) << 8) | hdr[7];
			uint16_t height = (uint16_t(hdr[8]) << 8) | hdr[9];
			uint32_t stride = (uint32_t(hdr[12]) << 24) | (uint32_t(hdr[13]) << 16) |
					 (uint32_t(hdr[14]) << 8) | hdr[15];
			uint32_t frameId = (uint32_t(hdr[16]) << 24) | (uint32_t(hdr[17]) << 16) |
					  (uint32_t(hdr[18]) << 8) | hdr[19];
			uint32_t payloadLen = (uint32_t(hdr[20]) << 24) | (uint32_t(hdr[21]) << 16) |
					     (uint32_t(hdr[22]) << 8) | hdr[23];

			if (!width || !height || payloadLen == 0 || payloadLen > 64u * 1024u * 1024u)
				break;

			std::vector<uint8_t> pixels(payloadLen);
			if (!recv_all(s, pixels.data(), (int)payloadLen))
				break;

			pthread_mutex_lock(&ctx->mutex);
			/* Drop-old: previous frame never consumed by video_tick → backpressure. */
			if (ctx->dirty)
				ctx->drops.fetch_add(1);
			ctx->latest.pixels.swap(pixels);
			ctx->latest.width = width;
			ctx->latest.height = height;
			ctx->latest.stride = stride ? stride : (uint32_t)width * 4u;
			ctx->latest.frameId = frameId;
			ctx->hasFrame = true;
			ctx->dirty = true;
			ctx->lastFrameMs = os_gettime_ns() / 1000000ULL;
			pthread_mutex_unlock(&ctx->mutex);
		}

		closesocket(s);
		ctx->tcpConnected.store(false);
		if (!ctx->stop.load()) {
			os_sleep_ms(ctx->reconnectMs);
			if (ctx->reconnectMs < 2000u)
				ctx->reconnectMs = ctx->reconnectMs < 1000u ? ctx->reconnectMs + 200u : 2000u;
		}
	}

#ifdef _WIN32
	WSACleanup();
#endif
	return nullptr;
}

void OmoTcpFrames::init()
{
	pthread_mutex_init(&mutex, nullptr);
}

void OmoTcpFrames::destroy_gfx()
{
	if (tex) {
		obs_enter_graphics();
		gs_texture_destroy(tex);
		obs_leave_graphics();
		tex = nullptr;
		texW = texH = 0;
	}
}

void OmoTcpFrames::destroy()
{
	stop_reader();
	destroy_gfx();
	pthread_mutex_destroy(&mutex);
}

void OmoTcpFrames::start()
{
	if (threadStarted)
		return;
	stop.store(false);
	reconnectMs = 200;
	if (pthread_create(&thread, nullptr, reader_thread, this) == 0)
		threadStarted = true;
}

void OmoTcpFrames::stop_reader()
{
	if (!threadStarted)
		return;
	stop.store(true);
	pthread_join(thread, nullptr);
	threadStarted = false;
	tcpConnected.store(false);
}

void OmoTcpFrames::discover(uint16_t hostPort)
{
	std::string body = http_get_local(hostPort, "/api/obs-plugin/frame-bridge");
	int discovered = json_get_int(body, "port", 0);
	bool enabled = json_get_bool(body, "enabled", false);
	if (discovered > 0 && discovered < 65536)
		framePort = (uint16_t)discovered;
	if (!enabled)
		http_post_local(hostPort, "/api/obs-plugin/frame-bridge/start", "{}");
}

bool OmoTcpFrames::take_frame(OmoFrameBuffer &out)
{
	pthread_mutex_lock(&mutex);
	if (!dirty || !hasFrame || latest.pixels.empty()) {
		pthread_mutex_unlock(&mutex);
		return false;
	}
	out = latest;
	out.pixels = latest.pixels;
	dirty = false;
	pthread_mutex_unlock(&mutex);
	return true;
}

void OmoTcpFrames::upload_texture()
{
	OmoFrameBuffer local;
	if (!take_frame(local))
		return;
	if (local.pixels.empty() || !local.width || !local.height)
		return;

	obs_enter_graphics();
	if (!tex || texW != local.width || texH != local.height) {
		if (tex)
			gs_texture_destroy(tex);
		tex = gs_texture_create(local.width, local.height, GS_BGRA, 1, nullptr, GS_DYNAMIC);
		texW = local.width;
		texH = local.height;
	}
	if (tex) {
		uint8_t *ptr;
		uint32_t linesize;
		if (gs_texture_map(tex, &ptr, &linesize)) {
			const uint8_t *src = local.pixels.data();
			uint32_t copyW = local.width * 4;
			if (copyW > linesize)
				copyW = linesize;
			for (uint32_t y = 0; y < local.height; y++) {
				memcpy(ptr + y * linesize, src + y * local.stride, copyW);
			}
			gs_texture_unmap(tex);
		}
	}
	obs_leave_graphics();
}

void OmoTcpFrames::render()
{
	if (!tex)
		return;

	const bool previous = gs_framebuffer_srgb_enabled();
	gs_enable_framebuffer_srgb(false);

	gs_effect_t *effect = obs_get_base_effect(OBS_EFFECT_DEFAULT);
	gs_eparam_t *image = gs_effect_get_param_by_name(effect, "image");
	gs_effect_set_texture(image, tex);

	gs_blend_state_push();
	gs_blend_function(GS_BLEND_ONE, GS_BLEND_INVSRCALPHA);
	while (gs_effect_loop(effect, "Draw")) {
		gs_draw_sprite(tex, 0, texW, texH);
	}
	gs_blend_state_pop();

	gs_enable_framebuffer_srgb(previous);
}
