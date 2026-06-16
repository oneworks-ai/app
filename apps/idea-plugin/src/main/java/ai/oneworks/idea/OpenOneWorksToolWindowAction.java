package ai.oneworks.idea;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;

public final class OpenOneWorksToolWindowAction extends AnAction implements DumbAware {
    @Override
    public void actionPerformed(AnActionEvent event) {
        Project project = event.getProject();
        if (project == null || project.isDisposed()) {
            return;
        }

        ToolWindow toolWindow = ToolWindowManager.getInstance(project)
            .getToolWindow(OneWorksPluginConstants.TOOL_WINDOW_ID);
        if (toolWindow != null) {
            toolWindow.show();
        }
    }
}
