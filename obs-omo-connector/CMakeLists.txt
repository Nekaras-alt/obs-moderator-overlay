cmake_minimum_required(VERSION 3.28)
project(omo-connector VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC OFF)

option(OMO_INSTALL_TO_APPDATA "Install into %AppData%/obs-studio/plugins" ON)

if(NOT OBS_DIR)
  set(OBS_DIR "" CACHE PATH "Path to OBS Studio build/install (include + lib)")
endif()

if(NOT OBS_DIR)
  message(FATAL_ERROR "Set -DOBS_DIR= to your OBS Studio prefix (headers + obs.lib / obs-frontend-api.lib)")
endif()

find_package(Qt6 COMPONENTS Widgets Network QUIET)
if(NOT Qt6_FOUND)
  find_package(Qt5 COMPONENTS Widgets Network REQUIRED)
  set(OMO_QT_LIBS Qt5::Widgets Qt5::Network)
else()
  set(OMO_QT_LIBS Qt6::Widgets Qt6::Network)
endif()

add_library(omo-connector MODULE
  src/plugin-main.cpp
  src/omo-source.cpp
  src/omo-native-source.cpp
  src/omo-dock.cpp
  src/http-local.cpp
)

target_include_directories(omo-connector PRIVATE
  "${OBS_DIR}/libobs"
  "${OBS_DIR}/UI/obs-frontend-api"
  "${OBS_DIR}"
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
)

# Support both in-tree OBS build layouts and installed SDK layouts.
if(WIN32)
  set(_obs_lib_candidates
    "${OBS_DIR}/libobs/$<CONFIG>/obs.lib"
    "${OBS_DIR}/lib/obs.lib"
    "${OBS_DIR}/bin/64bit/obs.lib"
  )
  set(_fea_lib_candidates
    "${OBS_DIR}/UI/obs-frontend-api/$<CONFIG>/obs-frontend-api.lib"
    "${OBS_DIR}/lib/obs-frontend-api.lib"
    "${OBS_DIR}/bin/64bit/obs-frontend-api.lib"
  )
  # Generator expressions can't be in if(); link with primary in-tree paths + Qt.
  target_link_libraries(omo-connector PRIVATE
    "${OBS_DIR}/libobs/$<CONFIG>/obs.lib"
    "${OBS_DIR}/UI/obs-frontend-api/$<CONFIG>/obs-frontend-api.lib"
    ${OMO_QT_LIBS}
    winhttp
  )
  set_target_properties(omo-connector PROPERTIES
    PREFIX ""
    OUTPUT_NAME "omo-connector"
  )
else()
  target_link_libraries(omo-connector PRIVATE obs obs-frontend-api ${OMO_QT_LIBS})
endif()

# Stage a ready-to-copy plugin tree under build/dist/omo-connector/
set(OMO_STAGE "${CMAKE_BINARY_DIR}/dist/omo-connector")
add_custom_command(TARGET omo-connector POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${OMO_STAGE}/bin/64bit"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${OMO_STAGE}/data/locale"
  COMMAND ${CMAKE_COMMAND} -E make_directory "${OMO_STAGE}/sidecar"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "$<TARGET_FILE:omo-connector>"
    "${OMO_STAGE}/bin/64bit/"
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    "${CMAKE_CURRENT_SOURCE_DIR}/data/locale"
    "${OMO_STAGE}/data/locale"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    "${CMAKE_CURRENT_SOURCE_DIR}/sidecar/README.txt"
    "${OMO_STAGE}/sidecar/README.txt"
  COMMENT "Staging omo-connector plugin package"
)

if(OMO_INSTALL_TO_APPDATA AND WIN32)
  set(_appdata "$ENV{APPDATA}/obs-studio/plugins/omo-connector")
  install(CODE "
    file(MAKE_DIRECTORY \"${_appdata}/bin/64bit\")
    file(MAKE_DIRECTORY \"${_appdata}/data/locale\")
    file(MAKE_DIRECTORY \"${_appdata}/sidecar\")
    file(COPY \"$<TARGET_FILE:omo-connector>\" DESTINATION \"${_appdata}/bin/64bit\")
    file(COPY \"${CMAKE_CURRENT_SOURCE_DIR}/data/locale\" DESTINATION \"${_appdata}/data\")
    file(COPY \"${CMAKE_CURRENT_SOURCE_DIR}/sidecar/README.txt\" DESTINATION \"${_appdata}/sidecar\")
  ")
endif()
