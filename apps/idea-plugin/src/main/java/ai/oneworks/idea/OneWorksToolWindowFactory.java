package ai.oneworks.idea;

import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;
import org.jetbrains.annotations.NotNull;

public final class OneWorksToolWindowFactory implements ToolWindowFactory, DumbAware {
    @Override
    public void createToolWindowContent(@NotNull Project project, @NotNull ToolWindow toolWindow) {
        OneWorksProjectService service = project.getService(OneWorksProjectService.class);
        Content content = ContentFactory.getInstance()
            .createContent(service.createToolWindowComponent(), "", false);
        toolWindow.getContentManager().addContent(content);
    }
}
