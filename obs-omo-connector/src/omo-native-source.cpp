#include <obs-module.h>
#include <util/platform.h>
#include <string>
#include <cstdio>
#include "http-local.hpp"
#include "omo-tcp-frames.hpp"

/* Legacy id omo_overlay_native — kept for scene migration; hidden via CAP_OBSOLETE. */

struct omo_native {
	obs_source_t *source = nullptr;
	uint16_t hostPort = 8090;
	bool active = true;
	float status_accum = 0.f;
	std::string status_line;
	OmoTcpFrames frames;
};

static const char *omo_native_name(void *)
{
	return obs_module_text("OmoOverlayNativeLegacy");
}

static void set_status(omo_native *ctx, const char *line)
{
	ctx->status_line = line ? line : "";
}

static void heartbeat(omo_native *ctx, bool connected, uint32_t frameId)
{
	char body[384];
	snprintf(body, sizeof(body),
		 "{\"type\":\"native\",\"id\":\"native\",\"connected\":%s,\"frameId\":%u,"
		 "\"detail\":\"tcp:%u\",\"drops\":%llu}",
		 connected ? "true" : "false", (unsigned)frameId, (unsigned)ctx->frames.framePort,
		 (unsigned long long)ctx->frames.drops.load());
	http_post_local(ctx->hostPort, "/api/obs-plugin/heartbeat", body);
}

static void update_live_status(omo_native *ctx)
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
		set_status(ctx, obs_module_text("StatusInactive"));
	} else if (!tcp) {
		snprintf(line, sizeof(line), "%s (:%u)", obs_module_text("StatusWaitingFrames"),
			 (unsigned)ctx->frames.framePort);
		set_status(ctx, line);
	} else if (!has) {
		set_status(ctx, obs_module_text("StatusNativeLinkedNoFrame"));
	} else {
		snprintf(line, sizeof(line), "%s · frame %u · lag %llums · drops %llu",
			 obs_module_text("StatusNativeLinked"), (unsigned)frameId,
			 (unsigned long long)age, (unsigned long long)drops);
		set_status(ctx, line);
	}
	heartbeat(ctx, tcp && has, frameId);
}

static void *omo_native_create(obs_data_t *settings, obs_source_t *source)
{
	omo_native *ctx = new omo_native();
	ctx->source = source;
	ctx->frames.init();
	ctx->hostPort = (uint16_t)obs_data_get_int(settings, "host_port");
	ctx->frames.framePort = (uint16_t)obs_data_get_int(settings, "frame_port");
	if (!ctx->hostPort)
		ctx->hostPort = 8090;
	if (!ctx->frames.framePort)
		ctx->frames.framePort = 8092;
	ctx->active = obs_data_get_bool(settings, "active");
	set_status(ctx, obs_module_text("StatusConnecting"));
	ctx->frames.discover(ctx->hostPort);
	if (ctx->active)
		ctx->frames.start();
	return ctx;
}

static void omo_native_destroy(void *data)
{
	omo_native *ctx = (omo_native *)data;
	ctx->frames.destroy();
	delete ctx;
}

static void omo_native_update(void *data, obs_data_t *settings)
{
	omo_native *ctx = (omo_native *)data;
	ctx->hostPort = (uint16_t)obs_data_get_int(settings, "host_port");
	ctx->frames.framePort = (uint16_t)obs_data_get_int(settings, "frame_port");
	if (!ctx->hostPort)
		ctx->hostPort = 8090;
	if (!ctx->frames.framePort)
		ctx->frames.framePort = 8092;
	bool active = obs_data_get_bool(settings, "active");
	ctx->frames.discover(ctx->hostPort);
	if (active && !ctx->active) {
		ctx->active = true;
		ctx->frames.start();
	} else if (!active && ctx->active) {
		ctx->active = false;
		ctx->frames.stop_reader();
		set_status(ctx, obs_module_text("StatusInactive"));
	} else if (active) {
		ctx->frames.stop_reader();
		ctx->frames.start();
	}
}

static void omo_native_defaults(obs_data_t *settings)
{
	obs_data_set_default_int(settings, "host_port", 8090);
	obs_data_set_default_int(settings, "frame_port", 8092);
	obs_data_set_default_bool(settings, "active", true);
	obs_data_set_default_string(settings, "status_line", "");
}

static obs_properties_t *omo_native_properties(void *)
{
	obs_properties_t *props = obs_properties_create();
	obs_properties_add_text(props, "status_line", obs_module_text("ConnectionStatus"), OBS_TEXT_INFO);
	obs_properties_add_int(props, "host_port", obs_module_text("HostPort"), 1, 65535, 1);
	obs_properties_add_int(props, "frame_port", obs_module_text("FramePort"), 1, 65535, 1);
	obs_properties_add_bool(props, "active", obs_module_text("Active"));
	return props;
}

static void omo_native_tick(void *data, float seconds)
{
	omo_native *ctx = (omo_native *)data;
	ctx->status_accum += seconds;
	if (ctx->status_accum >= 1.0f) {
		ctx->status_accum = 0.f;
		update_live_status(ctx);
	}
	if (ctx->active)
		ctx->frames.upload_texture();
}

static void omo_native_render(void *data, gs_effect_t *)
{
	omo_native *ctx = (omo_native *)data;
	ctx->frames.render();
}

static uint32_t omo_native_width(void *data)
{
	return ((omo_native *)data)->frames.width();
}

static uint32_t omo_native_height(void *data)
{
	return ((omo_native *)data)->frames.height();
}

void register_omo_native_source()
{
	obs_source_info info = {};
	info.id = "omo_overlay_native";
	info.type = OBS_SOURCE_TYPE_INPUT;
	info.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW | OBS_SOURCE_DO_NOT_DUPLICATE |
			    OBS_SOURCE_SRGB | OBS_SOURCE_CAP_OBSOLETE;
	info.get_name = omo_native_name;
	info.create = omo_native_create;
	info.destroy = omo_native_destroy;
	info.update = omo_native_update;
	info.get_defaults = omo_native_defaults;
	info.get_properties = omo_native_properties;
	info.video_tick = omo_native_tick;
	info.video_render = omo_native_render;
	info.get_width = omo_native_width;
	info.get_height = omo_native_height;
	info.icon_type = OBS_ICON_TYPE_CUSTOM;
	obs_register_source(&info);
}
