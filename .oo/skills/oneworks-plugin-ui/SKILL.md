---
name: oneworks-plugin-ui
description: Design or revise OneWorks client plugin routes, workspace sidebars, launcher pages, route headers, breadcrumbs, actions, embedded host components, and plugin data loading. Use whenever a task creates or changes a plugin-owned UI so host chrome ownership is decided before markup and duplicate titles, navigation, refresh controls, or padding are avoided.
---

# OneWorks Plugin UI

Read `apps/client/src/plugins/AGENTS.md`, the target plugin's nearest `AGENTS.md`, and `.oo/skills/ui-design-memory/SKILL.md` before editing.

## Map the host before markup

Write down which layer owns each visible responsibility:

- route identity and selected resource name: `view.route.setTitle(...)`;
- hierarchy and back navigation: `view.route.setBreadcrumb(...)`;
- collection resources and search: `view.route.setSidebar(...)`;
- stable collection shortcuts beside the owning sidebar entry: `nav.items[].actions`;
- commands on the object currently named by the header: `view.route.setActions(...)`;
- focus/reconnect cache revalidation: `view.data.useQuery(...)`;
- embedded shared UI: `view.ui.*`, using flush/inset options when the route owns outer spacing.

The plugin body starts with actual content. Do not repeat a title already visible in the route header or breadcrumb. Do not place collection navigation in object actions. Do not add a refresh action when query revalidation is sufficient. Do not make both host and embedded content own the same padding.

## Extend the host conservatively

If a needed placement or behavior is missing, add a structured, plugin-agnostic host contract and consume it from the plugin. Do not imitate host chrome with plugin-local DOM/CSS and do not add package-name branches to the host.

## Verify the whole route

Check the root resource view and every secondary state at desktop and narrow widths. Assert:

- one visible owner for page identity;
- selected resource title updates in the shared header;
- sidebar actions stay beside their owning entry and navigate without reload;
- breadcrumbs are the only duplicate-free return path;
- header actions operate on the current object only;
- no redundant refresh or open-current-view action;
- no duplicated outer padding;
- focus/reconnect revalidation and post-mutation `mutate()` work.

Complete the independent revision-bound visual review required by `$ui-design-memory` before delivery.
