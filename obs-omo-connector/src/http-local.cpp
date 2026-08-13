#include "http-local.hpp"

#include <cstring>
#include <cstdlib>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>
#pragma comment(lib, "winhttp.lib")

static std::string winhttp_request(const wchar_t *method, uint16_t port, const char *path,
				   const char *body)
{
	std::string out;
	HINTERNET session = WinHttpOpen(L"OMO-Connector/0.1",
					WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
					WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
	if (!session)
		return out;

	HINTERNET conn = WinHttpConnect(session, L"127.0.0.1", port, 0);
	if (!conn) {
		WinHttpCloseHandle(session);
		return out;
	}

	wchar_t wpath[512];
	MultiByteToWideChar(CP_UTF8, 0, path, -1, wpath, 512);

	DWORD flags = 0;
	HINTERNET req = WinHttpOpenRequest(conn, method, wpath, nullptr, WINHTTP_NO_REFERER,
					   WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
	if (!req) {
		WinHttpCloseHandle(conn);
		WinHttpCloseHandle(session);
		return out;
	}

	BOOL ok = FALSE;
	if (body && *body) {
		const wchar_t *headers = L"Content-Type: application/json\r\n";
		DWORD bodyLen = (DWORD)strlen(body);
		ok = WinHttpSendRequest(req, headers, (DWORD)-1L, (LPVOID)body, bodyLen, bodyLen, 0);
	} else {
		ok = WinHttpSendRequest(req, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0,
					0, 0);
	}

	if (ok)
		ok = WinHttpReceiveResponse(req, nullptr);

	if (ok) {
		DWORD avail = 0;
		do {
			avail = 0;
			WinHttpQueryDataAvailable(req, &avail);
			if (!avail)
				break;
			std::string chunk(avail, '\0');
			DWORD read = 0;
			WinHttpReadData(req, chunk.data(), avail, &read);
			chunk.resize(read);
			out += chunk;
		} while (avail > 0);
	}

	WinHttpCloseHandle(req);
	WinHttpCloseHandle(conn);
	WinHttpCloseHandle(session);
	return out;
}

std::string http_get_local(uint16_t port, const char *path)
{
	return winhttp_request(L"GET", port, path, nullptr);
}

std::string http_post_local(uint16_t port, const char *path, const char *jsonBody)
{
	return winhttp_request(L"POST", port, path, jsonBody ? jsonBody : "{}");
}
#else
std::string http_get_local(uint16_t port, const char *path)
{
	(void)port;
	(void)path;
	return {};
}
std::string http_post_local(uint16_t port, const char *path, const char *jsonBody)
{
	(void)port;
	(void)path;
	(void)jsonBody;
	return {};
}
#endif

std::string json_get_string(const std::string &json, const char *key)
{
	std::string needle = std::string("\"") + key + "\"";
	size_t p = json.find(needle);
	if (p == std::string::npos)
		return {};
	p = json.find(':', p);
	if (p == std::string::npos)
		return {};
	p = json.find('"', p);
	if (p == std::string::npos)
		return {};
	size_t end = json.find('"', p + 1);
	if (end == std::string::npos)
		return {};
	return json.substr(p + 1, end - p - 1);
}

bool json_get_bool(const std::string &json, const char *key, bool defaultVal)
{
	std::string needle = std::string("\"") + key + "\"";
	size_t p = json.find(needle);
	if (p == std::string::npos)
		return defaultVal;
	p = json.find(':', p);
	if (p == std::string::npos)
		return defaultVal;
	while (p < json.size() && (json[p] == ':' || json[p] == ' '))
		p++;
	if (json.compare(p, 4, "true") == 0)
		return true;
	if (json.compare(p, 5, "false") == 0)
		return false;
	return defaultVal;
}

int json_get_int(const std::string &json, const char *key, int defaultVal)
{
	std::string needle = std::string("\"") + key + "\"";
	size_t p = json.find(needle);
	if (p == std::string::npos)
		return defaultVal;
	p = json.find(':', p);
	if (p == std::string::npos)
		return defaultVal;
	while (p < json.size() && (json[p] == ':' || json[p] == ' ' || json[p] == '\t'))
		p++;
	if (p >= json.size())
		return defaultVal;
	char *end = nullptr;
	long v = strtol(json.c_str() + p, &end, 10);
	if (end == json.c_str() + p)
		return defaultVal;
	return (int)v;
}
