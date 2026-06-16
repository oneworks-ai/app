package ai.oneworks.idea;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.PathManager;
import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.util.concurrency.AppExecutorUtil;
import org.jetbrains.annotations.NotNull;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

final class OneWorksServerController implements Disposable {
    private static final Logger LOG = Logger.getInstance(OneWorksServerController.class);
    private static final List<String> BOOTSTRAP_COMMAND_CANDIDATES = List.of("oneworks", "ow", "owo");
    private static final List<String> WINDOWS_COMMAND_EXTENSIONS = List.of(".cmd", ".exe", ".bat", ".ps1");

    private final Project project;
    private CompletableFuture<String> startFuture;
    private long startGeneration;
    private Process process;
    private String serverUrl;

    OneWorksServerController(@NotNull Project project) {
        this.project = project;
    }

    synchronized CompletableFuture<String> ensureStarted() {
        if (process != null && process.isAlive() && serverUrl != null) {
            return CompletableFuture.completedFuture(serverUrl);
        }
        if (startFuture != null) {
            return startFuture;
        }

        long generation = ++startGeneration;
        startFuture = CompletableFuture.supplyAsync(
            () -> startBlocking(generation),
            AppExecutorUtil.getAppExecutorService()
        ).whenComplete((url, error) -> {
            if (error != null) {
                synchronized (this) {
                    if (generation == startGeneration) {
                        startFuture = null;
                    }
                }
            }
        });
        return startFuture;
    }

    synchronized CompletableFuture<String> restart() {
        startGeneration++;
        stopProcess();
        startFuture = null;
        return ensureStarted();
    }

    private String startBlocking(long generation) {
        String basePath = project.getBasePath();
        if (basePath == null || basePath.isBlank()) {
            throw new IllegalStateException("The current IDE project has no base path.");
        }

        Path workspace = Path.of(basePath).toAbsolutePath().normalize();
        Path runtimeDir = runtimeDirectory(workspace);
        Path dataDir = runtimeDir.resolve("data");
        Path logDir = runtimeDir.resolve("logs");

        try {
            Files.createDirectories(dataDir);
            Files.createDirectories(logDir);
        } catch (IOException error) {
            throw new IllegalStateException("Unable to prepare One Works runtime directories: " + error.getMessage(), error);
        }

        IOException lastError = null;
        for (int attempt = 1; attempt <= OneWorksPluginConstants.SERVER_START_ATTEMPTS; attempt++) {
            try {
                int port = findAvailablePort();
                return startAttempt(workspace, dataDir, logDir, port, generation);
            } catch (IOException error) {
                if (error instanceof SupersededStartException) {
                    throw new IllegalStateException(error.getMessage(), error);
                }
                lastError = error;
                stopProcess();
                if (attempt < OneWorksPluginConstants.SERVER_START_ATTEMPTS) {
                    LOG.warn("One Works server startup attempt " + attempt + " failed. Retrying with a new port.", error);
                }
            }
        }

        throw new IllegalStateException(
            "Unable to start One Works server: " + (lastError == null ? "unknown error" : lastError.getMessage()),
            lastError
        );
    }

    private String startAttempt(Path workspace, Path dataDir, Path logDir, int port, long generation) throws IOException {
        ServerCommand serverCommand = serverCommand(workspace, dataDir, logDir, port);
        ProcessBuilder builder = new ProcessBuilder(serverCommand.command());
        builder.directory(workspace.toFile());
        builder.redirectErrorStream(true);
        applyEnvironment(builder.environment(), workspace, dataDir, logDir, port);

        LOG.info("Starting One Works server for " + workspace + " using " + serverCommand.source());
        Process child = builder.start();
        synchronized (this) {
            if (generation != startGeneration) {
                destroyProcessTreeForcibly(child);
                throw new SupersededStartException();
            }
            process = child;
        }

        AppExecutorUtil.getAppExecutorService().submit(() -> streamServerLogs(child));
        waitForServer(child, port, OneWorksPluginConstants.SERVER_READY_TIMEOUT);

        String url = "http://" + OneWorksPluginConstants.SERVER_HOST + ":" + port
            + OneWorksPluginConstants.CLIENT_BASE + "/";
        synchronized (this) {
            if (generation != startGeneration || process != child) {
                destroyProcessTreeForcibly(child);
                clearProcessIfSame(child);
                throw new SupersededStartException();
            }
            serverUrl = url;
        }
        return url;
    }

    private static void applyEnvironment(
        Map<String, String> env,
        Path workspace,
        Path dataDir,
        Path logDir,
        int port
    ) {
        env.remove("__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__");
        env.remove("__ONEWORKS_PROJECT_HOME_PROJECT_DIR__");
        env.remove("DB_PATH");

        Map<String, String> overrides = new LinkedHashMap<>();
        overrides.put("__ONEWORKS_PROJECT_LAUNCH_CWD__", workspace.toString());
        overrides.put("__ONEWORKS_PROJECT_WORKSPACE_FOLDER__", workspace.toString());
        overrides.put("__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__", workspace.toString());
        overrides.put("__ONEWORKS_PROJECT_CLIENT_BASE__", OneWorksPluginConstants.CLIENT_BASE);
        overrides.put("__ONEWORKS_PROJECT_CLIENT_MODE__", "static");
        overrides.put("__ONEWORKS_PROJECT_SERVER_HOST__", OneWorksPluginConstants.SERVER_HOST);
        overrides.put("__ONEWORKS_PROJECT_SERVER_PORT__", String.valueOf(port));
        overrides.put("__ONEWORKS_PROJECT_SERVER_WS_PATH__", OneWorksPluginConstants.SERVER_WS_PATH);
        overrides.put("__ONEWORKS_PROJECT_SERVER_ROLE__", "workspace");
        overrides.put("__ONEWORKS_PROJECT_SERVER_DATA_DIR__", dataDir.toString());
        overrides.put("__ONEWORKS_PROJECT_SERVER_LOG_DIR__", logDir.toString());
        overrides.put("__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__", "false");
        overrides.put("PATH", createProcessPath(workspace, env.get("PATH")));

        String realHome = env.get("__ONEWORKS_PROJECT_REAL_HOME__");
        if (realHome == null || realHome.isBlank()) {
            String home = env.get("HOME");
            if (home == null || home.isBlank()) {
                home = env.get("USERPROFILE");
            }
            if (home != null && !home.isBlank()) {
                overrides.put("__ONEWORKS_PROJECT_REAL_HOME__", home);
            }
        }

        env.putAll(overrides);
    }

    private static ServerCommand serverCommand(Path workspace, Path dataDir, Path logDir, int port) {
        List<String> webArgs = webArguments(workspace, dataDir, logDir, port);
        String fullOverride = System.getenv("ONEWORKS_IDEA_SERVER_COMMAND");
        if (fullOverride != null && !fullOverride.isBlank()) {
            return new ServerCommand(shellCommand(fullOverride), "ONEWORKS_IDEA_SERVER_COMMAND");
        }

        List<Path> searchPath = createSearchPath(workspace, System.getenv("PATH"));
        String configuredBootstrap = System.getenv("ONEWORKS_IDEA_BOOTSTRAP_COMMAND");
        if (configuredBootstrap != null && !configuredBootstrap.isBlank()) {
            Path executable = findExecutable(configuredBootstrap, workspace, searchPath);
            if (executable != null) {
                return new ServerCommand(prepend(executable.toString(), webArgs), "ONEWORKS_IDEA_BOOTSTRAP_COMMAND:" + executable);
            }
            return new ServerCommand(
                shellCommand(appendShellArguments(configuredBootstrap, webArgs)),
                "ONEWORKS_IDEA_BOOTSTRAP_COMMAND"
            );
        }

        for (String candidate : BOOTSTRAP_COMMAND_CANDIDATES) {
            Path executable = findExecutable(candidate, workspace, searchPath);
            if (executable != null) {
                return new ServerCommand(prepend(executable.toString(), webArgs), executable.toString());
            }
        }

        return new ServerCommand(
            shellCommand(appendShellArguments("npx -y oneworks", webArgs)),
            "npx -y oneworks"
        );
    }

    private static List<String> webArguments(Path workspace, Path dataDir, Path logDir, int port) {
        return List.of(
            "web",
            "--host",
            OneWorksPluginConstants.SERVER_HOST,
            "--port",
            String.valueOf(port),
            "--base",
            OneWorksPluginConstants.CLIENT_BASE,
            "--workspace",
            workspace.toString(),
            "--data-dir",
            dataDir.toString(),
            "--log-dir",
            logDir.toString()
        );
    }

    private static List<String> prepend(String command, List<String> args) {
        List<String> result = new ArrayList<>(args.size() + 1);
        result.add(command);
        result.addAll(args);
        return result;
    }

    private static List<String> shellCommand(String command) {
        if (isWindows()) {
            return List.of("cmd.exe", "/c", command);
        }

        String shell = System.getenv("SHELL");
        if (shell == null || shell.isBlank()) {
            shell = "/bin/sh";
        }
        return List.of(shell, "-lc", command);
    }

    private static String appendShellArguments(String command, List<String> args) {
        StringBuilder builder = new StringBuilder(command.trim());
        for (String arg : args) {
            builder.append(" ").append(quoteShellArgument(arg));
        }
        return builder.toString();
    }

    private static String quoteShellArgument(String value) {
        if (isWindows()) {
            return "\"" + value.replace("%", "%%").replace("\"", "\\\"") + "\"";
        }

        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    private static List<Path> createSearchPath(Path workspace, String pathValue) {
        List<Path> searchPath = new ArrayList<>();
        searchPath.add(workspace.resolve("node_modules").resolve(".bin"));
        if (pathValue == null || pathValue.isBlank()) {
            return searchPath;
        }

        for (String segment : pathValue.split(File.pathSeparator)) {
            if (!segment.isBlank()) {
                searchPath.add(Path.of(segment));
            }
        }
        return searchPath;
    }

    private static String createProcessPath(Path workspace, String pathValue) {
        List<String> segments = createSearchPath(workspace, pathValue).stream()
            .map(Path::toString)
            .toList();
        return String.join(File.pathSeparator, segments);
    }

    private static Path findExecutable(String command, Path workspace, List<Path> searchPath) {
        String trimmed = command.trim();
        if (trimmed.isEmpty()) {
            return null;
        }

        Path configuredPath = Path.of(trimmed);
        if (configuredPath.isAbsolute() || trimmed.contains("/") || trimmed.contains("\\")) {
            Path path = configuredPath.isAbsolute() ? configuredPath : workspace.resolve(configuredPath).normalize();
            return commandFileCandidates(path).stream()
                .filter(OneWorksServerController::isExecutable)
                .findFirst()
                .orElse(null);
        }

        for (Path dir : searchPath) {
            Path found = commandFileCandidates(dir.resolve(trimmed)).stream()
                .filter(OneWorksServerController::isExecutable)
                .findFirst()
                .orElse(null);
            if (found != null) {
                return found;
            }
        }
        return null;
    }

    private static List<Path> commandFileCandidates(Path command) {
        String fileName = command.getFileName() == null ? "" : command.getFileName().toString();
        if (!isWindows() || fileName.contains(".")) {
            return List.of(command);
        }

        List<Path> candidates = new ArrayList<>();
        candidates.add(command);
        for (String extension : WINDOWS_COMMAND_EXTENSIONS) {
            candidates.add(command.resolveSibling(fileName + extension));
        }
        return candidates;
    }

    private static boolean isExecutable(Path candidate) {
        return Files.isRegularFile(candidate) && (isWindows() || Files.isExecutable(candidate));
    }

    private static int findAvailablePort() throws IOException {
        try (ServerSocket socket = new ServerSocket()) {
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(OneWorksPluginConstants.SERVER_HOST, 0));
            return socket.getLocalPort();
        }
    }

    private static void waitForServer(Process child, int port, Duration timeout) throws IOException {
        long deadline = System.nanoTime() + timeout.toNanos();
        IOException lastError = null;
        while (System.nanoTime() < deadline) {
            if (!child.isAlive()) {
                throw new IOException("One Works server exited before it became ready.");
            }

            try {
                int readyStatus = requestStatus(port, OneWorksPluginConstants.SERVER_READY_PATH);
                if (readyStatus < 500) {
                    int uiStatus = requestStatus(port, OneWorksPluginConstants.SERVER_UI_READY_PATH);
                    if (uiStatus >= 200 && uiStatus < 400) {
                        return;
                    }
                    lastError = new IOException("One Works UI returned status " + uiStatus + ".");
                } else {
                    lastError = new IOException("One Works readiness endpoint returned status " + readyStatus + ".");
                }
            } catch (IOException error) {
                lastError = error;
            }

            try {
                Thread.sleep(250);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while waiting for One Works server.", error);
            }
        }

        String message = "Timed out waiting for One Works server on port " + port + ".";
        if (lastError != null && lastError.getMessage() != null) {
            message += " Last error: " + lastError.getMessage();
        }
        throw new IOException(message, lastError);
    }

    private static int requestStatus(int port, String requestPath) throws IOException {
        URI uri = URI.create("http://" + OneWorksPluginConstants.SERVER_HOST + ":" + port + requestPath);
        URL url = uri.toURL();
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(1000);
        connection.setReadTimeout(1000);
        connection.setRequestMethod("GET");
        try {
            return connection.getResponseCode();
        } finally {
            connection.disconnect();
        }
    }

    private static Path runtimeDirectory(Path workspace) {
        String key = sha256(workspace.toString()).substring(0, 16);
        return Path.of(PathManager.getSystemPath(), "oneworks", "idea-plugin", key);
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder(bytes.length * 2);
            for (byte item : bytes) {
                builder.append(String.format("%02x", item));
            }
            return builder.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is not available.", error);
        }
    }

    private static void streamServerLogs(Process child) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
            child.getInputStream(),
            StandardCharsets.UTF_8
        ))) {
            String line;
            while ((line = reader.readLine()) != null) {
                LOG.info("[server] " + line);
            }
        } catch (IOException error) {
            LOG.warn("Failed to read One Works server output.", error);
        }
    }

    private synchronized void stopProcess() {
        Process child = process;
        process = null;
        serverUrl = null;
        if (child == null || !child.isAlive()) {
            return;
        }

        destroyProcessTree(child);
        try {
            if (!child.waitFor(3, TimeUnit.SECONDS)) {
                destroyProcessTreeForcibly(child);
            }
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            destroyProcessTreeForcibly(child);
        }
    }

    private synchronized void clearProcessIfSame(Process child) {
        if (process == child) {
            process = null;
            serverUrl = null;
        }
    }

    private static void destroyProcessTree(Process child) {
        try (Stream<ProcessHandle> descendants = child.descendants()) {
            descendants.forEach(ProcessHandle::destroy);
        }
        child.destroy();
    }

    private static void destroyProcessTreeForcibly(Process child) {
        try (Stream<ProcessHandle> descendants = child.descendants()) {
            descendants.forEach(ProcessHandle::destroyForcibly);
        }
        child.destroyForcibly();
    }

    @Override
    public void dispose() {
        synchronized (this) {
            startGeneration++;
            startFuture = null;
        }
        stopProcess();
    }

    static boolean isSupersededStartup(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof SupersededStartException) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private record ServerCommand(List<String> command, String source) {
    }

    private static final class SupersededStartException extends IOException {
        private SupersededStartException() {
            super("One Works server startup was superseded by a newer attempt.");
        }
    }
}
