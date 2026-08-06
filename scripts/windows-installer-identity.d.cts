declare const installerIdentity: {
  WINGET_COMMANDS: string[]
  assertStableWindowsMsiVersion(version: string): string
  assertWingetInstallerTemplate(
    content: string,
    input: { installerSha256?: string; version: string }
  ): { installerSha256: string; installerUrl: string; productCode: string; version: string }
  buildCanonicalScoopInstallerUrl(version: string): string
  buildCanonicalWingetInstallerUrl(version: string): string
  buildStableWindowsMsiProductCode(version: string): string
}

export = installerIdentity
