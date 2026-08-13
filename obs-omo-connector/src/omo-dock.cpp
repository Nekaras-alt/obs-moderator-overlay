#include <obs-module.h>
#include <obs-frontend-api.h>
#include <QWidget>
#include <QLabel>
#include <QPushButton>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLineEdit>
#include <QCheckBox>
#include <QTimer>
#include <QProcess>
#include <QProcessEnvironment>
#include <QFileInfo>
#include <QApplication>
#include <QClipboard>
#include <QDir>
#include <string>
#include "http-local.hpp"

class OmoPanel : public QWidget {
public:
	explicit OmoPanel(QWidget *parent = nullptr) : QWidget(parent)
	{
		auto *layout = new QVBoxLayout(this);

		status_ = new QLabel(QString::fromUtf8(obs_module_text("HostOffline")), this);
		join_ = new QLabel(QStringLiteral("Join: —"), this);
		url_ = new QLabel(QStringLiteral("Overlay (local): —"), this);
		url_->setWordWrap(true);
		url_->setTextInteractionFlags(Qt::TextSelectableByMouse);
		remoteUrl_ = new QLabel(QStringLiteral("Overlay (remote): —"), this);
		remoteUrl_->setWordWrap(true);
		remoteUrl_->setTextInteractionFlags(Qt::TextSelectableByMouse);
		frames_ = new QLabel(QStringLiteral("Frames: —"), this);

		portEdit_ = new QLineEdit(QStringLiteral("8090"), this);
		sidecarEdit_ = new QLineEdit(this);
		sidecarEdit_->setPlaceholderText(QString::fromUtf8(obs_module_text("SidecarPathHint")));

		autoRestart_ = new QCheckBox(QString::fromUtf8(obs_module_text("AutoRestartSidecar")), this);
		autoRestart_->setChecked(true);

		auto *row = new QHBoxLayout();
		auto *refresh = new QPushButton(QString::fromUtf8(obs_module_text("Refresh")), this);
		auto *copyJoin = new QPushButton(QString::fromUtf8(obs_module_text("CopyJoin")), this);
		auto *copyUrl = new QPushButton(QString::fromUtf8(obs_module_text("CopyOverlayUrl")), this);
		auto *copyRemote = new QPushButton(QString::fromUtf8(obs_module_text("CopyRemoteOverlayUrl")), this);
		row->addWidget(refresh);
		row->addWidget(copyJoin);
		row->addWidget(copyUrl);
		row->addWidget(copyRemote);

		auto *row2 = new QHBoxLayout();
		auto *startBtn = new QPushButton(QString::fromUtf8(obs_module_text("StartSidecar")), this);
		auto *stopBtn = new QPushButton(QString::fromUtf8(obs_module_text("StopSidecar")), this);
		auto *relayBtn = new QPushButton(QString::fromUtf8(obs_module_text("StartRelay")), this);
		auto *stopRelayBtn = new QPushButton(QString::fromUtf8(obs_module_text("StopRelay")), this);
		row2->addWidget(startBtn);
		row2->addWidget(stopBtn);
		row2->addWidget(relayBtn);
		row2->addWidget(stopRelayBtn);

		layout->addWidget(status_);
		layout->addWidget(join_);
		layout->addWidget(url_);
		layout->addWidget(remoteUrl_);
		layout->addWidget(frames_);
		layout->addWidget(new QLabel(QString::fromUtf8(obs_module_text("HostPort")), this));
		layout->addWidget(portEdit_);
		layout->addWidget(new QLabel(QString::fromUtf8(obs_module_text("SidecarExe")), this));
		layout->addWidget(sidecarEdit_);
		layout->addWidget(autoRestart_);
		layout->addLayout(row);
		layout->addLayout(row2);
		layout->addStretch(1);

		QObject::connect(refresh, &QPushButton::clicked, [this]() { refreshStatus(); });
		QObject::connect(copyJoin, &QPushButton::clicked, [this]() { copyText(joinCode_); });
		QObject::connect(copyUrl, &QPushButton::clicked, [this]() { copyText(overlayUrl_); });
		QObject::connect(copyRemote, &QPushButton::clicked, [this]() { copyText(remoteOverlayUrl_); });
		QObject::connect(startBtn, &QPushButton::clicked, [this]() { startSidecar(); });
		QObject::connect(stopBtn, &QPushButton::clicked, [this]() { stopSidecar(false); });
		QObject::connect(relayBtn, &QPushButton::clicked, [this]() { startRelay(); });
		QObject::connect(stopRelayBtn, &QPushButton::clicked, [this]() { stopRelay(); });

		timer_ = new QTimer(this);
		QObject::connect(timer_, &QTimer::timeout, [this]() {
			refreshStatus();
			watchSidecar();
		});
		timer_->start(3000);

		discoverSidecar();
		refreshStatus();
	}

	~OmoPanel() override { stopSidecar(true); }

	void refreshStatus()
	{
		uint16_t port = currentPort();
		std::string body = http_get_local(port, "/api/obs-plugin/info");
		if (body.empty()) {
			hostOnline_ = false;
			status_->setText(QString::fromUtf8(obs_module_text("HostOffline")));
			join_->setText(QStringLiteral("Join: —"));
			url_->setText(QStringLiteral("Overlay (local): —"));
			remoteUrl_->setText(QStringLiteral("Overlay (remote): —"));
			frames_->setText(QStringLiteral("Frames: —"));
			joinCode_.clear();
			overlayUrl_.clear();
			remoteOverlayUrl_.clear();
			return;
		}
		hostOnline_ = true;
		joinCode_ = QString::fromStdString(json_get_string(body, "joinCode"));
		overlayUrl_ = QString::fromStdString(json_get_string(body, "overlayUrl"));
		remoteOverlayUrl_ = QString::fromStdString(json_get_string(body, "remoteOverlayUrl"));
		QString profile = QString::fromStdString(json_get_string(body, "profile"));
		bool paired = json_get_bool(body, "paired", false);
		QString mode = QString::fromStdString(json_get_string(body, "mode"));

		status_->setText(QString::fromUtf8(obs_module_text("HostOnlineFmt"))
					 .arg(profile.isEmpty() ? QStringLiteral("?") : profile)
					 .arg(paired ? QStringLiteral("paired") : QStringLiteral("waiting"))
					 .arg(mode.isEmpty() ? QStringLiteral("host") : mode));
		join_->setText(QStringLiteral("Join: %1").arg(joinCode_.isEmpty() ? QStringLiteral("—") : joinCode_));
		url_->setText(QStringLiteral("Overlay (local): %1")
				      .arg(overlayUrl_.isEmpty() ? QStringLiteral("—") : overlayUrl_));
		remoteUrl_->setText(QStringLiteral("Overlay (remote): %1")
					    .arg(remoteOverlayUrl_.isEmpty() ? QStringLiteral("—") : remoteOverlayUrl_));

		std::string fb = http_get_local(port, "/api/obs-plugin/frame-bridge");
		bool fbOn = json_get_bool(fb, "enabled", false);
		int fbPort = json_get_int(fb, "port", 8092);
		int frameId = json_get_int(fb, "frameId", 0);
		frames_->setText(fbOn
					 ? QStringLiteral("Frames: on · :%1 · id %2 (use Native source)")
						   .arg(fbPort)
						   .arg(frameId)
					 : QStringLiteral("Frames: off (enable OMO_FRAME_BRIDGE=1)"));
	}

	void startSidecar()
	{
		QString exe = sidecarEdit_->text().trimmed();
		if (exe.isEmpty() || !QFileInfo::exists(exe)) {
			status_->setText(QString::fromUtf8(obs_module_text("SidecarMissing")));
			return;
		}
		if (proc_ && proc_->state() != QProcess::NotRunning)
			return;
		if (!proc_) {
			proc_ = new QProcess(this);
			QObject::connect(proc_, QOverload<int, QProcess::ExitStatus>::of(&QProcess::finished),
					 [this](int, QProcess::ExitStatus) {
						 status_->setText(QString::fromUtf8(obs_module_text("SidecarStopped")));
					 });
		}
		proc_->setProgram(exe);
		proc_->setArguments(QStringList() << QStringLiteral("--mode=host-obs"));
		QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
		env.insert(QStringLiteral("OMO_MODE"), QStringLiteral("host-obs"));
		env.insert(QStringLiteral("OMO_CONNECTOR_AUTO"), QStringLiteral("1"));
		env.insert(QStringLiteral("PORT"), portEdit_->text().trimmed());
		proc_->setProcessEnvironment(env);
		proc_->setWorkingDirectory(QFileInfo(exe).absolutePath());
		proc_->start();
		userStopped_ = false;
		status_->setText(QString::fromUtf8(obs_module_text("SidecarStarting")));
		QTimer::singleShot(1500, [this]() { refreshStatus(); });
	}

	void stopSidecar(bool silent)
	{
		userStopped_ = true;
		if (proc_ && proc_->state() != QProcess::NotRunning) {
			proc_->terminate();
			if (!proc_->waitForFinished(4000))
				proc_->kill();
		}
		if (!silent)
			status_->setText(QString::fromUtf8(obs_module_text("SidecarStopped")));
	}

	void startRelay()
	{
		uint16_t port = currentPort();
		std::string res = http_post_local(port, "/api/connector/host/start", "{}");
		if (res.empty())
			status_->setText(QString::fromUtf8(obs_module_text("RelayFailed")));
		QTimer::singleShot(500, [this]() { refreshStatus(); });
	}

	void stopRelay()
	{
		uint16_t port = currentPort();
		http_post_local(port, "/api/connector/host/stop", "{}");
		QTimer::singleShot(400, [this]() { refreshStatus(); });
	}

private:
	uint16_t currentPort() const
	{
		bool ok = false;
		unsigned port = portEdit_->text().toUInt(&ok);
		if (!ok || !port)
			port = 8090;
		return (uint16_t)port;
	}

	void copyText(const QString &text)
	{
		if (text.isEmpty())
			return;
		if (QClipboard *clip = QApplication::clipboard())
			clip->setText(text);
	}

	void discoverSidecar()
	{
		const char *env = getenv("OMO_SIDECAR_EXE");
		if (env && *env) {
			sidecarEdit_->setText(QString::fromLocal8Bit(env));
			return;
		}
		/* Next to plugin install: …/plugins/omo-connector/bin/64bit/ → ../../sidecar/ */
		QString module = QString::fromUtf8(obs_get_module_binary_path(obs_current_module()));
		QDir binDir = QFileInfo(module).absoluteDir();
		QString candidate = binDir.absoluteFilePath(QStringLiteral("../../sidecar/OBS Moderator Overlay.exe"));
		if (QFileInfo::exists(candidate)) {
			sidecarEdit_->setText(QDir::toNativeSeparators(candidate));
			return;
		}
		candidate = binDir.absoluteFilePath(QStringLiteral("../../sidecar/OBS-Overlay-Portable.exe"));
		if (QFileInfo::exists(candidate))
			sidecarEdit_->setText(QDir::toNativeSeparators(candidate));
	}

	void watchSidecar()
	{
		if (!autoRestart_->isChecked() || userStopped_)
			return;
		if (!proc_)
			return;
		if (proc_->state() == QProcess::NotRunning && !sidecarEdit_->text().trimmed().isEmpty()) {
			/* Only auto-restart if we previously started it and host is offline. */
			if (!hostOnline_)
				startSidecar();
		}
	}

	QLabel *status_ = nullptr;
	QLabel *join_ = nullptr;
	QLabel *url_ = nullptr;
	QLabel *remoteUrl_ = nullptr;
	QLabel *frames_ = nullptr;
	QLineEdit *portEdit_ = nullptr;
	QLineEdit *sidecarEdit_ = nullptr;
	QCheckBox *autoRestart_ = nullptr;
	QTimer *timer_ = nullptr;
	QProcess *proc_ = nullptr;
	QString joinCode_;
	QString overlayUrl_;
	QString remoteOverlayUrl_;
	bool hostOnline_ = false;
	bool userStopped_ = true;
};

void register_omo_dock()
{
	auto *panel = new OmoPanel();
	if (!obs_frontend_add_dock_by_id("omo_connector_dock", obs_module_text("OmoDock"), panel)) {
		blog(LOG_ERROR, "[omo-connector] failed to register dock (need OBS 30+)");
		delete panel;
	}
}
