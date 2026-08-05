import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

export const desktopDemoFixtureIds = ['adapter-promo'] as const
export type DesktopDemoFixtureId = typeof desktopDemoFixtureIds[number]

export interface DesktopDemoFixturePayload {
  directories: string[]
  home: string
  id: DesktopDemoFixtureId
  schemaVersion: 1
  workspaces: Array<{
    actualPath: string
    displayPath: string
  }>
}

const fixtureDefinitions = {
  'adapter-promo': {
    directories: ['Desktop', 'Documents', 'Downloads', 'Projects'],
    home: '/Users/oneworks',
    workspaceName: 'oneworks-demo'
  }
} as const satisfies Record<DesktopDemoFixtureId, {
  directories: readonly string[]
  home: string
  workspaceName: string
}>

export const parseDesktopDemoFixtureId = (value: string): DesktopDemoFixtureId => {
  if (desktopDemoFixtureIds.includes(value as DesktopDemoFixtureId)) {
    return value as DesktopDemoFixtureId
  }
  throw new TypeError(
    `Unknown desktop demo fixture "${value}". Expected one of: ${desktopDemoFixtureIds.join(', ')}.`
  )
}

export const createDesktopDemoFixture = ({
  id,
  workspace
}: {
  id: DesktopDemoFixtureId
  workspace: string
}): DesktopDemoFixturePayload => {
  if (workspace.trim() === '') {
    throw new TypeError(`Desktop demo fixture "${id}" requires a real workspace.`)
  }
  const definition = fixtureDefinitions[id]
  const displayWorkspacePath = path.posix.join(
    definition.home,
    'Projects',
    definition.workspaceName
  )
  const resolvedWorkspacePath = path.resolve(workspace)
  const actualWorkspacePath = existsSync(resolvedWorkspacePath)
    ? realpathSync(resolvedWorkspacePath)
    : resolvedWorkspacePath

  return {
    directories: [
      ...definition.directories.map(directory => path.posix.join(definition.home, directory)),
      displayWorkspacePath
    ],
    home: definition.home,
    id,
    schemaVersion: 1,
    workspaces: [{
      actualPath: actualWorkspacePath,
      displayPath: displayWorkspacePath
    }]
  }
}

export const getDesktopDemoFixtureWorkspace = (fixture: DesktopDemoFixturePayload) => (
  fixture.workspaces[0]?.displayPath
)

export const getDesktopDemoFixtureEnvironment = (fixture: DesktopDemoFixturePayload) => ({
  ONEWORKS_DESKTOP_RECORDING_DEMO_FIXTURE: JSON.stringify(fixture),
  __ONEWORKS_PROJECT_DISABLE_DEV_CONFIG__: '1',
  __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1'
})

export const getDesktopDemoFixturePageSetupExpression = (fixture: DesktopDemoFixturePayload) => {
  if (fixture.workspaces[0] == null) {
    throw new TypeError(`Desktop demo fixture "${fixture.id}" requires a workspace mapping.`)
  }
  const exactReplacements = [
    ['Bug 修复模式', 'Bug Fix'],
    ['代码评审模式', 'Code Review'],
    ['文档梳理模式', 'Documentation']
  ].filter(([source, target]) => source !== target)
  const config = JSON.stringify({
    accountListTitles: ['Account list', '账号列表'],
    exactReplacements,
    recentAccountSubtitles: ['Frequent account', '最近常用账号'],
    safeEmail: 'demo@oneworks.ai',
    safeLabels: {
      en: {
        accountList: 'Demo accounts',
        accountName: 'Demo User',
        sessionTitle: 'Demo session'
      },
      zh: {
        accountList: '演示账号',
        accountName: '演示用户',
        sessionTitle: '演示会话'
      }
    },
    workspacePresentations: fixture.workspaces.map(workspace => ({
      actualName: path.basename(workspace.actualPath),
      actualPath: workspace.actualPath,
      displayName: path.posix.basename(workspace.displayPath),
      displayPath: workspace.displayPath
    }))
  })

  return `(() => {
    const config = ${config};
    const emailPattern = /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/gi;
    const replaceText = value => {
      const trimmed = value.trim();
      let next = value;
      for (const [source, target] of config.exactReplacements) {
        if (trimmed === source) {
          next = value.replace(source, target);
          break;
        }
      }
      return next.replace(emailPattern, email =>
        email.toLowerCase() === config.safeEmail ? email : config.safeEmail
      );
    };
    const setText = (element, value) => {
      if (element != null && element.textContent !== value) element.textContent = value;
    };
    const apply = () => {
      if (document.documentElement == null) return;
      const labels = document.documentElement.lang.toLowerCase().startsWith('zh')
        ? config.safeLabels.zh
        : config.safeLabels.en;
      const walker = document.createTreeWalker(
        document.documentElement,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: node => {
            const tagName = node.parentElement?.tagName;
            return tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT'
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      let node;
      while ((node = walker.nextNode()) != null) {
        const current = node.nodeValue ?? '';
        const next = replaceText(current);
        if (next !== current) node.nodeValue = next;
      }
      for (const item of document.querySelectorAll('.launcher-command-item')) {
        const title = item.querySelector('.launcher-command-item__title');
        const subtitle = item.querySelector('.launcher-command-item__subtitle');
        const subtitleText = subtitle?.textContent ?? '';
        if (config.recentAccountSubtitles.some(value => subtitleText.includes(value))) {
          setText(title, labels.accountName);
        } else if (config.accountListTitles.includes(title?.textContent?.trim() ?? '')) {
          setText(subtitle, labels.accountList);
        }
      }
      for (const title of document.querySelectorAll('.session-title-text')) {
        setText(title, labels.sessionTitle);
      }
      for (const accountLabel of document.querySelectorAll('.account-select .ant-select-selection-item')) {
        const nextAccountLabel = (accountLabel.textContent ?? '').replace(/\\bPersonal\\b/gu, 'Demo');
        setText(accountLabel, nextAccountLabel);
      }
      for (const label of document.querySelectorAll('.chat-header-title-project')) {
        const presentation = config.workspacePresentations.find(candidate =>
          label.textContent?.trim() === candidate.actualName || label.getAttribute('title') === candidate.actualPath
        );
        if (presentation == null) continue;
        setText(label, presentation.displayName);
        if (label.getAttribute('title') !== presentation.displayPath) {
          label.setAttribute('title', presentation.displayPath);
        }
      }
      const nextTitle = replaceText(document.title);
      if (nextTitle !== document.title) document.title = nextTitle;
    };
    window.__oneworksDesktopDemoFixtureObserver?.disconnect();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { characterData: true, childList: true, subtree: true });
    window.__oneworksDesktopDemoFixtureObserver = observer;
    apply();
    return true;
  })()`
}
