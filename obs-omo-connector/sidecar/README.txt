Place the OBS Moderator Overlay portable executable here (host-obs sidecar).

Recommended names the dock auto-discovers:
  - OBS Moderator Overlay.exe
  - OBS-Overlay-Portable.exe

Then start OBS → Docks → OMO Connector → Start sidecar.

Or set environment variable OMO_SIDECAR_EXE to the full path.

The sidecar is started as:
  "<exe>" --mode=host-obs
with OMO_MODE=host-obs and OMO_CONNECTOR_AUTO=1.
