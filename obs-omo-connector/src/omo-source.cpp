#include <obs-module.h>
#include <util/platform.h>
#include <string>
#include <cstring>
#include <cstdio>
#include "http-local.hpp"
#include "omo-tcp-frames.hpp"

enum class OmoMode { Native, Browser, BrowserRemote };

struct omo_source {
	obs_source_t *source = nullptr;
	obs_source_t *browser = nullptr;
	OmoMode mode = OmoMode::Native;
	uint16_t hostPort = 8090;
	uint32_t width = 1920;
	uint32_t height = 1080;
	bool active = true;
	bool auto_refresh = true;
	float refresh_accum = 0.f;
	float status_accum = 0.f;
	std::string last_url;
	std::string overlay_url;
	std::string relay_url;
	std::string join_code;
	std::string status_line;
	bool host_ok = false;
	OmoTcpFrames frames;
};

static bool is_cef_mode(OmoMode m)
{
	return m == OmoMode::Browser || m == OmoMode::BrowserRemote;
}

static OmoMode parse_mode(const char *s)
{
	if (s && strcmp(s, "browser-remote") == 0)
		return OmoMode::BrowserRemote;
	if (s && strcmp(s, "browser") == 0)
		return OmoMode::Browser;
	if (s && strcmp(s, "native") == 0)
		return OmoMode::Native;
	/* Empty/missing: treat as browser so pre-v0.4 omo_overlay scenes keep CEF. */
	if (!s || !*s)
		return OmoMode::Browser;
	return OmoMode::Native;
}

static std::string trim_copy(const char *s)
{
	if (!s)
		return {};
	std::string t = s;
	while (!t.empty() && (t.back() == ' ' || t.back() == '\t' || t.back() == '\n' || t.back() == '\r'))
		t.pop_back();
	size_t i = 0;
	while (i < t.size() && (t[i] == ' ' || t[i] == '\t'))
		i++;
	return t.substr(i);
}

static std::string normalize_join_code(const std::string &in)
{
	std::string out;
	for (unsigned char c : in) {
		if (c >= 'a' && c <= 'z')
			out += char(c - 32);
		else if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))
			out += char(c);
	}
	return out;
}

static std::string overlay_url_from_relay(const std::string &relay, const std::string &code)
{
	if (relay.empty() || code.empty())
		return {};
	std::string scheme = "https";
	std::string rest = relay;
	auto scheme_end = relay.find("://");
	if (scheme_end != std::string::npos) {
		scheme = relay.substr(0, scheme_end);
		rest = relay.substr(scheme_end + 3);
		if (scheme == "wss")
			scheme = "https";
		else if (scheme == "ws")
			scheme = "http";
	}
	auto slash = rest.find('/');
	std::string host = slash == std::string::npos ? rest : rest.substr(0, slash);
	if (host.empty())
		return {};
	return scheme + "://" + host + "/o/" + code + "/obs";
}

static const char *omo_get_name(void *)
{
	return obs_module_text("OmoOverlay");
}

static void set_status(omo_source *ctx, const char *line, bool hostOk)
{
	ctx->status_line = line ? line : "";
	ctx->host_ok = hostOk;
	/* Do not call obs_source_update_properties or write settings from tick/update.
	   Rebuilding the Qt properties dialog while WidgetInfo::ControlChanged is on
	   the stack (Mode combo) crashes OBS (c0000005). Status is copied in get_properties. */
}

static void destroy_browser(omo_source *ctx)
{
	if (ctx->browser) {
		obs_source_remove_active_child(ctx->source, ctx->browser);
		obs_source_release(ctx->browser);
		ctx->browser = nullptr;
	}
}

static void ensure_browser(omo_source *ctx, const char *url)
{
	if (!url || !*url)
		return;

	obs_data_t *settings = obs_data_create();
	obs_data_set_string(settings, "url", url);
	obs_data_set_int(settings, "width", (long long)ctx->width);
	obs_data_set_int(settings, "height", (long long)ctx->height);
	obs_data_set_bool(settings, "shutdown", true);
	obs_data_set_bool(settings, "restart_when_active", true);
	obs_data_set_bool(settings, "fps_custom", true);
	obs_data_set_int(settings, "fps", 60);
	obs_data_set_string(settings, "css",
			    "html, body, #app, .obs-root { background: transparent !important; "
			    "background-color: rgba(0,0,0,0) !important; margin: 0 !important; "
			    "overflow: hidden !important; }");

	if (!ctx->browser) {
		ctx->browser = obs_source_create_private("browser_source", "OMO CEF", settings);
		if (!ctx->browser)
			ctx->browser = obs_source_create("browser_source", "OMO CEF", settings, nullptr);
		if (ctx->browser)
			obs_source_add_active_child(ctx->source, ctx->browser);
		else
			blog(LOG_WARNING, "[omo-connector] browser_source unavailable — is obs-browser loaded?");
	} else {
		obs_source_update(ctx->browser, settings);
	}
	obs_data_release(settings);
	ctx->last_url = url;
}

static void heartbeat(omo_source *ctx, bool connected, uint32_t frameId)
{
	char body[384];
	if (ctx->mode == OmoMode::Native) {
		snprintf(body, sizeof(body),
			 "{\"type\":\"native\",\"id\":\"native\",\"connected\":%s,\"frameId\":%u,"
			 "\"detail\":\"tcp:%u\",\"drops\":%llu}",
			 connected ? "true" : "false", (unsigned)frameId, (unsigned)ctx->frames.framePort,
			 (unsigned long long)ctx->frames.drops.load());
	} else {
		snprintf(body, sizeof(body),
			 "{\"type\":\"browser\",\"id\":\"browser\",\"connected\":%s,\"detail\":\"%s\"}",
			 connected ? "true" : "false", connected ? "url-ok" : "host-offline");
	}
	http_post_local(ctx->hostPort, "/api/obs-plugin/heartbeat", body);
}

static void refresh_browser(omo_source *ctx)
{
	if (!ctx->active) {
		set_status(ctx, obs_module_text("StatusInactive"), false);
		return;
	}

	std::string body = http_get_local(ctx->hostPort, "/api/obs-plugin/info");
	std::string url = json_get_string(body, "overlayUrl");
	if (url.empty()) {
		set_status(ctx, obs_module_text("StatusHostOffline"), false);
		heartbeat(ctx, false, 0);
		char fallback[320];
		snprintf(fallback, sizeof(fallback), "http://127.0.0.1:%u/obs", (unsigned)ctx->hostPort);
		url = fallback;
	} else {
		set_status(ctx, obs_module_text("StatusBrowserLinked"), true);
		heartbeat(ctx, true, 0);
	}

	if (url == ctx->last_url && ctx->browser)
		return;
	ensure_browser(ctx, url.c_str());
}

static void refresh_browser_remote(omo_source *ctx)
{
	if (!ctx->active) {
		set_status(ctx, obs_module_text("StatusInactive"), false);
		return;
	}

	std::string url = trim_copy(ctx->overlay_url.c_str());
	if (url.empty())
		url = overlay_url_from_relay(trim_copy(ctx->relay_url.c_str()),
					    normalize_join_code(ctx->join_code));
	if (url.empty()) {
		set_status(ctx, obs_module_text("StatusNeedRemoteUrl"), false);
		destroy_browser(ctx);
		ctx->last_url.clear();
		return;
	}

	set_status(ctx, obs_module_text("StatusRemoteOverlay"), true);
	if (url == ctx->last_url && ctx->browser)
		return;
	ensure_browser(ctx, url.c_str());
}

static void update_native_status(omo_source *ctx)
{
	char line[320];
	bool tcp = ctx->frames.tcpConnected.load();
	uint32_t frameId = 0;
	uint64_t age = 0;
	bool has = false;
	uint64_t drops = ctx->frames.drops.load();

	pthread_mutex_lock(&ctx->frames.mutex);
	has = ctx->frames.hasFrame;
	frameId = ctx->frames.latest.frameId;
	if (ctx->frames.lastFrameMs) {
		uint64_t now = os_gettime_ns() / 1000000ULL;
		age = now > ctx->frames.lastFrameMs ? now - ctx->frames.lastFrameMs : 0;
	}
	pthread_mutex_unlock(&ctx->frames.mutex);

	if (!ctx->active) {
		set_status(ctx, obs_module_text("StatusInactive"), false);
	} else if (!tcp) {
		snprintf(line, sizeof(line), "%s (:%u)", obs_module_text("StatusWaitingFrames"),
			 (unsigned)ctx->frames.framePort);
		set_status(ctx, line, false);
	} else if (!has) {
		set_status(ctx, obs_module_text("StatusNativeLinkedNoFrame"), true);
	} else {
		snprintf(line, sizeof(line), "%s · frame %u · lag %llums · drops %llu",
			 obs_module_text("StatusNativeLinked"), (unsigned)frameId,
			 (unsigned long long)age, (unsigned long long)drops);
		set_status(ctx, line, true);
	}
	heartbeat(ctx, tcp && has, frameId);
}

static void apply_mode_runtime(omo_source *ctx)
{
	if (ctx->mode == OmoMode::Native) {
		destroy_browser(ctx);
		ctx->last_url.clear();
		ctx->frames.discover(ctx->hostPort);
		if (ctx->active)
			ctx->frames.start();
		else
			ctx->frames.stop_reader();
	} else if (ctx->mode == OmoMode::BrowserRemote) {
		ctx->frames.stop_reader();
		if (ctx->active)
			refresh_browser_remote(ctx);
		else {
			destroy_browser(ctx);
			set_status(ctx, obs_module_text("StatusInactive"), false);
		}
	} else {
		ctx->frames.stop_reader();
		if (ctx->active)
			refresh_browser(ctx);
		else {
			destroy_browser(ctx);
			set_status(ctx, obs_module_text("StatusInactive"), false);
		}
	}
}

static uint16_t read_host_port(obs_data_t *settings)
{
	uint16_t p = (uint16_t)obs_data_get_int(settings, "host_port");
	if (!p)
		p = (uint16_t)obs_data_get_int(settings, "port"); /* pre-v0.4 browser field */
	if (!p)
		p = 8090;
	return p;
}

static void *omo_create(obs_data_t *settings, obs_source_t *source)
{
	omo_source *ctx = new omo_source();
	ctx->source = source;
	ctx->frames.init();
	ctx->mode = parse_mode(obs_data_get_string(settings, "mode"));
	ctx->hostPort = read_host_port(settings);
	ctx->frames.framePort = (uint16_t)obs_data_get_int(settings, "frame_port");
	if (!ctx->frames.framePort)
		ctx->frames.framePort = 8092;
	ctx->width = (uint32_t)obs_data_get_int(settings, "width");
	ctx->height = (uint32_t)obs_data_get_int(settings, "height");
	if (!ctx->width)
		ctx->width = 1920;
	if (!ctx->height)
		ctx->height = 1080;
	ctx->active = obs_data_get_bool(settings, "active");
	ctx->auto_refresh = obs_data_get_bool(settings, "auto_refresh");
	ctx->overlay_url = trim_copy(obs_data_get_string(settings, "overlay_url"));
	ctx->relay_url = trim_copy(obs_data_get_string(settings, "relay_url"));
	ctx->join_code = normalize_join_code(trim_copy(obs_data_get_string(settings, "join_code")));
	set_status(ctx, obs_module_text("StatusConnecting"), false);
	apply_mode_runtime(ctx);
	return ctx;
}

static void omo_destroy(void *data)
{
	omo_source *ctx = (omo_source *)data;
	destroy_browser(ctx);
	ctx->frames.destroy();
	delete ctx;
}

static void omo_update(void *data, obs_data_t *settings)
{
	omo_source *ctx = (omo_source *)data;
	OmoMode prev = ctx->mode;
	ctx->mode = parse_mode(obs_data_get_string(settings, "mode"));
	ctx->hostPort = read_host_port(settings);
	ctx->frames.framePort = (uint16_t)obs_data_get_int(settings, "frame_port");
	if (!ctx->frames.framePort)
		ctx->frames.framePort = 8092;
	ctx->width = (uint32_t)obs_data_get_int(settings, "width");
	ctx->height = (uint32_t)obs_data_get_int(settings, "height");
	if (!ctx->width)
		ctx->width = 1920;
	if (!ctx->height)
		ctx->height = 1080;
	ctx->active = obs_data_get_bool(settings, "active");
	ctx->auto_refresh = obs_data_get_bool(settings, "auto_refresh");
	ctx->overlay_url = trim_copy(obs_data_get_string(settings, "overlay_url"));
	ctx->relay_url = trim_copy(obs_data_get_string(settings, "relay_url"));
	ctx->join_code = normalize_join_code(trim_copy(obs_data_get_string(settings, "join_code")));

	if (ctx->mode != prev || ctx->mode == OmoMode::Native) {
		if (ctx->mode == OmoMode::Native) {
			ctx->frames.stop_reader();
		}
		ctx->last_url.clear();
	}
	apply_mode_runtime(ctx);
}

static void omo_get_defaults(obs_data_t *settings)
{
	obs_data_set_default_string(settings, "mode", "native");
	obs_data_set_default_int(settings, "host_port", 8090);
	obs_data_set_default_int(settings, "port", 8090);
	obs_data_set_default_int(settings, "frame_port", 8092);
	obs_data_set_default_int(settings, "width", 1920);
	obs_data_set_default_int(settings, "height", 1080);
	obs_data_set_default_bool(settings, "active", true);
	obs_data_set_default_bool(settings, "auto_refresh", true);
	obs_data_set_default_string(settings, "status_line", "");
	obs_data_set_default_string(settings, "overlay_url", "");
	obs_data_set_default_string(settings, "relay_url", "");
	obs_data_set_default_string(settings, "join_code", "");
}

static bool refresh_clicked(obs_properties_t *, obs_property_t *, void *data)
{
	omo_source *ctx = (omo_source *)data;
	if (ctx) {
		if (ctx->mode == OmoMode::Browser) {
			ctx->last_url.clear();
			refresh_browser(ctx);
		} else if (ctx->mode == OmoMode::BrowserRemote) {
			ctx->last_url.clear();
			refresh_browser_remote(ctx);
		} else {
			ctx->frames.discover(ctx->hostPort);
			ctx->frames.stop_reader();
			if (ctx->active)
				ctx->frames.start();
			update_native_status(ctx);
		}
	}
	return true;
}

static bool mode_modified(obs_properties_t *props, obs_property_t *, obs_data_t *settings)
{
	const char *mode = obs_data_get_string(settings, "mode");
	bool browser = mode && strcmp(mode, "browser") == 0;
	bool remote = mode && strcmp(mode, "browser-remote") == 0;
	bool cef = browser || remote;
	obs_property_t *p;
	p = obs_properties_get(props, "host_port");
	if (p)
		obs_property_set_visible(p, !remote);
	p = obs_properties_get(props, "frame_port");
	if (p)
		obs_property_set_visible(p, !cef);
	p = obs_properties_get(props, "width");
	if (p)
		obs_property_set_visible(p, cef);
	p = obs_properties_get(props, "height");
	if (p)
		obs_property_set_visible(p, cef);
	p = obs_properties_get(props, "auto_refresh");
	if (p)
		obs_property_set_visible(p, cef);
	p = obs_properties_get(props, "overlay_url");
	if (p)
		obs_property_set_visible(p, remote);
	p = obs_properties_get(props, "relay_url");
	if (p)
		obs_property_set_visible(p, remote);
	p = obs_properties_get(props, "join_code");
	if (p)
		obs_property_set_visible(p, remote);
	return true;
}

static obs_properties_t *omo_get_properties(void *data)
{
	obs_properties_t *props = obs_properties_create();
	obs_properties_set_param(props, data, nullptr);
	obs_properties_add_text(props, "status_line", obs_module_text("ConnectionStatus"), OBS_TEXT_INFO);

	obs_property_t *mode = obs_properties_add_list(props, "mode", obs_module_text("Mode"),
						       OBS_COMBO_TYPE_LIST, OBS_COMBO_FORMAT_STRING);
	obs_property_list_add_string(mode, obs_module_text("ModeNative"), "native");
	obs_property_list_add_string(mode, obs_module_text("ModeBrowser"), "browser");
	obs_property_list_add_string(mode, obs_module_text("ModeBrowserRemote"), "browser-remote");
	obs_property_set_modified_callback(mode, mode_modified);

	obs_properties_add_int(props, "host_port", obs_module_text("HostPort"), 1, 65535, 1);
	obs_properties_add_int(props, "frame_port", obs_module_text("FramePort"), 1, 65535, 1);
	obs_properties_add_text(props, "overlay_url", obs_module_text("OverlayUrl"), OBS_TEXT_DEFAULT);
	obs_properties_add_text(props, "relay_url", obs_module_text("RelayUrl"), OBS_TEXT_DEFAULT);
	obs_properties_add_text(props, "join_code", obs_module_text("JoinCode"), OBS_TEXT_DEFAULT);
	obs_properties_add_int(props, "width", obs_module_text("Width"), 16, 7680, 2);
	obs_properties_add_int(props, "height", obs_module_text("Height"), 16, 4320, 2);
	obs_properties_add_bool(props, "active", obs_module_text("Active"));
	obs_properties_add_bool(props, "auto_refresh", obs_module_text("AutoRefresh"));
	obs_properties_add_button(props, "refresh", obs_module_text("RefreshUrl"), refresh_clicked);

	if (data) {
		omo_source *ctx = (omo_source *)data;
		obs_data_t *settings = obs_source_get_settings(ctx->source);
		obs_data_set_string(settings, "status_line", ctx->status_line.c_str());
		mode_modified(props, mode, settings);
		obs_data_release(settings);
	}
	return props;
}

static void omo_video_tick(void *data, float seconds)
{
	omo_source *ctx = (omo_source *)data;
	if (!ctx->active)
		return;

	if (ctx->mode == OmoMode::Native)
		ctx->frames.upload_texture();

	ctx->status_accum += seconds;
	float interval = ctx->mode == OmoMode::Native ? 1.0f : 1.5f;
	if (ctx->status_accum >= interval) {
		ctx->status_accum = 0.f;
		if (ctx->mode == OmoMode::Native) {
			update_native_status(ctx);
		} else if (ctx->mode == OmoMode::BrowserRemote) {
			if (ctx->auto_refresh)
				refresh_browser_remote(ctx);
		} else if (ctx->auto_refresh) {
			refresh_browser(ctx);
		} else {
			heartbeat(ctx, ctx->host_ok, 0);
		}
		/* Properties refresh only via set_status dirty-flag — avoid closing Mode combo. */
	}
}

static void omo_video_render(void *data, gs_effect_t *)
{
	omo_source *ctx = (omo_source *)data;
	if (ctx->mode == OmoMode::Native) {
		ctx->frames.render();
		return;
	}
	if (ctx->browser)
		obs_source_video_render(ctx->browser);
}

static uint32_t omo_width(void *data)
{
	omo_source *ctx = (omo_source *)data;
	if (ctx->mode == OmoMode::Native)
		return ctx->frames.width();
	if (ctx->browser) {
		uint32_t w = obs_source_get_width(ctx->browser);
		if (w)
			return w;
	}
	return ctx->width;
}

static uint32_t omo_height(void *data)
{
	omo_source *ctx = (omo_source *)data;
	if (ctx->mode == OmoMode::Native)
		return ctx->frames.height();
	if (ctx->browser) {
		uint32_t h = obs_source_get_height(ctx->browser);
		if (h)
			return h;
	}
	return ctx->height;
}

static void omo_enum_active(void *data, obs_source_enum_proc_t enum_cb, void *param)
{
	omo_source *ctx = (omo_source *)data;
	if (is_cef_mode(ctx->mode) && ctx->browser)
		enum_cb(ctx->source, ctx->browser, param);
}

void register_omo_source()
{
	obs_source_info info = {};
	info.id = "omo_overlay";
	info.type = OBS_SOURCE_TYPE_INPUT;
	info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW | OBS_SOURCE_DO_NOT_DUPLICATE |
			    OBS_SOURCE_SRGB;
	info.get_name = omo_get_name;
	info.create = omo_create;
	info.destroy = omo_destroy;
	info.update = omo_update;
	info.get_defaults = omo_get_defaults;
	info.get_properties = omo_get_properties;
	info.video_tick = omo_video_tick;
	info.video_render = omo_video_render;
	info.get_width = omo_width;
	info.get_height = omo_height;
	info.enum_active_sources = omo_enum_active;
	info.icon_type = OBS_ICON_TYPE_CUSTOM;
	obs_register_source(&info);
}
