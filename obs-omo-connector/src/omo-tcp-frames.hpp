#pragma once

#include <obs-module.h>
#include <util/threading.h>
#include <util/platform.h>
#include <string>
#include <vector>
#include <atomic>
#include <cstdint>

/* TCP OMOF frame client (BGRA). SHM path is TODO — see omo-tcp-frames.cpp. */

struct OmoFrameBuffer {
	std::vector<uint8_t> pixels;
	uint32_t width = 0;
	uint32_t height = 0;
	uint32_t stride = 0;
	uint32_t frameId = 0;
};

struct OmoTcpFrames {
	uint16_t framePort = 8092;
	std::atomic<bool> stop{false};
	std::atomic<bool> tcpConnected{false};
	pthread_t thread{};
	bool threadStarted = false;

	pthread_mutex_t mutex{};
	OmoFrameBuffer latest;
	bool hasFrame = false;
	bool dirty = false; /* true until graphics tick consumes */
	uint64_t lastFrameMs = 0;
	std::atomic<uint64_t> drops{0};
	uint32_t reconnectMs = 200;

	gs_texture_t *tex = nullptr;
	uint32_t texW = 0;
	uint32_t texH = 0;

	void init();
	void destroy_gfx();
	void destroy();
	void start();
	void stop_reader();
	void discover(uint16_t hostPort);
	/* Copy latest frame if dirty; clears dirty. Returns true if copied. */
	bool take_frame(OmoFrameBuffer &out);
	void upload_texture();
	void render();
	uint32_t width() const { return texW ? texW : 1920; }
	uint32_t height() const { return texH ? texH : 1080; }
};
