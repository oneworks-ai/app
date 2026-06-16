package ai.oneworks.idea;

import java.time.Duration;

final class OneWorksPluginConstants {
    static final String DISPLAY_NAME = "One Works";
    static final String TOOL_WINDOW_ID = "One Works";
    static final String SERVER_HOST = "127.0.0.1";
    static final String CLIENT_BASE = "/ui";
    static final String SERVER_READY_PATH = "/api/auth/status";
    static final String SERVER_UI_READY_PATH = CLIENT_BASE + "/";
    static final String SERVER_WS_PATH = "/ws";
    static final int SERVER_START_ATTEMPTS = 3;
    static final Duration SERVER_READY_TIMEOUT = Duration.ofSeconds(120);

    private OneWorksPluginConstants() {
    }
}
