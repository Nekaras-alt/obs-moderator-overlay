#pragma once
#include <string>
#include <cstdint>

/** GET http://127.0.0.1:port/path → body (empty on failure). */
std::string http_get_local(uint16_t port, const char *path);

/** POST http://127.0.0.1:port/path with JSON body → response body. */
std::string http_post_local(uint16_t port, const char *path, const char *jsonBody);

/** Extract "key":"value" from a flat JSON object (good enough for our API). */
std::string json_get_string(const std::string &json, const char *key);

/** Extract boolean; returns defaultVal if missing. */
bool json_get_bool(const std::string &json, const char *key, bool defaultVal = false);

/** Extract integer JSON value. */
int json_get_int(const std::string &json, const char *key, int defaultVal = 0);
