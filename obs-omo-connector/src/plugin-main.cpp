#include <obs-module.h>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("omo-connector", "en-US")

MODULE_EXPORT const char *obs_module_name(void)
{
	return "OMO Connector";
}

MODULE_EXPORT const char *obs_module_description(void)
{
	return "OMO Overlay source for OBS Moderator Overlay (Native / Browser local / Browser remote)";
}

MODULE_EXPORT const char *obs_module_author(void)
{
	return "Aptix / OMO";
}

extern void register_omo_source();
extern void register_omo_native_source();

#ifndef OMO_NO_DOCK
extern void register_omo_dock();
#endif

bool obs_module_load(void)
{
	blog(LOG_INFO, "[omo-connector] loading v0.5.0");
	register_omo_source();
	register_omo_native_source(); /* obsolete id kept for scene migration */
#ifndef OMO_NO_DOCK
	register_omo_dock();
#else
	blog(LOG_INFO, "[omo-connector] dock disabled (standalone build without Qt)");
#endif
	blog(LOG_INFO, "[omo-connector] loaded");
	return true;
}

void obs_module_unload(void)
{
	blog(LOG_INFO, "[omo-connector] unloaded");
}
