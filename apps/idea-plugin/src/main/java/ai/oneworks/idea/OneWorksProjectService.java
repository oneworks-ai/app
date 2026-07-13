package ai.oneworks.idea;

import com.intellij.ide.BrowserUtil;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.util.Disposer;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.jcef.JBCefApp;
import com.intellij.ui.jcef.JBCefBrowser;
import com.intellij.util.ui.JBUI;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.util.concurrent.CompletionException;

public final class OneWorksProjectService implements Disposable {
    private final Project project;
    private final OneWorksServerController serverController;
    private JBCefBrowser browser;

    public OneWorksProjectService(@NotNull Project project) {
        this.project = project;
        this.serverController = new OneWorksServerController(project);
    }

    public JComponent createToolWindowComponent() {
        JPanel root = new JPanel(new BorderLayout());
        loadClient(root);
        return root;
    }

    private void loadClient(JPanel root) {
        showStatus(root, "Starting One Works server for this project...");
        serverController.ensureStarted().whenComplete((url, error) ->
            ApplicationManager.getApplication().invokeLater(() -> {
                if (project.isDisposed()) {
                    return;
                }
                Throwable unwrappedError = unwrap(error);
                if (unwrappedError != null) {
                    if (OneWorksServerController.isSupersededStartup(unwrappedError)) {
                        return;
                    }
                    showError(root, unwrappedError);
                    return;
                }
                showClient(root, url);
            }, ModalityState.any())
        );
    }

    private void showClient(JPanel root, String url) {
        if (!JBCefApp.isSupported()) {
            showUnsupportedJcef(root, url);
            return;
        }

        disposeBrowser();
        root.removeAll();
        root.add(createToolbar(root, url), BorderLayout.NORTH);

        browser = new JBCefBrowser(url);
        root.add(browser.getComponent(), BorderLayout.CENTER);
        refresh(root);
    }

    private JPanel createToolbar(JPanel root, String url) {
        JPanel toolbar = new JPanel(new BorderLayout());
        toolbar.setBorder(JBUI.Borders.empty(4, 8));

        JLabel label = new JBLabel(url);
        toolbar.add(label, BorderLayout.CENTER);

        JPanel actions = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
        JButton openExternal = new JButton("Open in Browser");
        openExternal.addActionListener(event -> BrowserUtil.browse(url));
        actions.add(openExternal);

        JButton restart = new JButton("Restart Server");
        restart.addActionListener(event -> restartServer(root));
        actions.add(restart);

        toolbar.add(actions, BorderLayout.EAST);
        return toolbar;
    }

    private void restartServer(JPanel root) {
        showStatus(root, "Restarting One Works server...");
        serverController.restart().whenComplete((url, error) ->
            ApplicationManager.getApplication().invokeLater(() -> {
                if (project.isDisposed()) {
                    return;
                }
                Throwable unwrappedError = unwrap(error);
                if (unwrappedError != null) {
                    if (OneWorksServerController.isSupersededStartup(unwrappedError)) {
                        return;
                    }
                    showError(root, unwrappedError);
                    return;
                }
                showClient(root, url);
            }, ModalityState.any())
        );
    }

    private void showUnsupportedJcef(JPanel root, String url) {
        disposeBrowser();
        JPanel panel = new JPanel(new BorderLayout());
        panel.setBorder(JBUI.Borders.empty(24));

        JLabel label = new JBLabel(
            "<html>JCEF is not available in this IDE runtime.<br/>Open One Works in an external browser instead.</html>",
            SwingConstants.CENTER
        );
        panel.add(label, BorderLayout.CENTER);

        JButton openExternal = new JButton("Open in Browser");
        openExternal.addActionListener(event -> BrowserUtil.browse(url));
        JPanel buttonRow = new JPanel(new FlowLayout(FlowLayout.CENTER));
        buttonRow.add(openExternal);
        panel.add(buttonRow, BorderLayout.SOUTH);

        root.removeAll();
        root.add(panel, BorderLayout.CENTER);
        refresh(root);
    }

    private void showError(JPanel root, Throwable error) {
        disposeBrowser();
        JPanel panel = new JPanel(new BorderLayout());
        panel.setBorder(JBUI.Borders.empty(24));

        String message = error.getMessage() == null ? error.toString() : error.getMessage();
        JLabel label = new JBLabel(
            "<html><b>One Works failed to start.</b><br/>" + escapeHtml(message) + "</html>",
            SwingConstants.CENTER
        );
        panel.add(label, BorderLayout.CENTER);

        JPanel actions = new JPanel(new FlowLayout(FlowLayout.CENTER));
        JButton retry = new JButton("Retry");
        retry.addActionListener(event -> loadClient(root));
        actions.add(retry);

        JButton details = new JButton("Details");
        details.addActionListener(event ->
            Messages.showErrorDialog(project, stackMessage(error), "One Works Startup Error")
        );
        actions.add(details);
        panel.add(actions, BorderLayout.SOUTH);

        root.removeAll();
        root.add(panel, BorderLayout.CENTER);
        refresh(root);
    }

    private void showStatus(JPanel root, String message) {
        disposeBrowser();
        root.removeAll();
        JLabel label = new JBLabel(message, SwingConstants.CENTER);
        label.setBorder(JBUI.Borders.empty(24));
        root.add(label, BorderLayout.CENTER);
        refresh(root);
    }

    private static void refresh(JPanel root) {
        root.revalidate();
        root.repaint();
    }

    private static Throwable unwrap(Throwable error) {
        if (error == null) {
            return null;
        }
        if (error instanceof CompletionException && error.getCause() != null) {
            return error.getCause();
        }
        return error;
    }

    private static String stackMessage(Throwable error) {
        StringBuilder builder = new StringBuilder();
        Throwable current = error;
        while (current != null) {
            if (builder.length() > 0) {
                builder.append("\nCaused by: ");
            }
            builder.append(current.getClass().getName()).append(": ");
            builder.append(current.getMessage() == null ? "" : current.getMessage());
            current = current.getCause();
        }
        return builder.toString();
    }

    private static String escapeHtml(String value) {
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;");
    }

    private void disposeBrowser() {
        if (browser == null) {
            return;
        }

        Disposer.dispose(browser);
        browser = null;
    }

    @Override
    public void dispose() {
        disposeBrowser();
        serverController.dispose();
    }
}
