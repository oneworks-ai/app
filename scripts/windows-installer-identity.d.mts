export declare const WINGET_COMMANDS: string[]
export declare function buildCanonicalScoopInstallerUrl(version: string): string
export declare function buildCanonicalWingetInstallerUrl(version: string): string
export declare function assertWingetInstallerTemplate(
  content: string,
  input: { installerSha256?: string; version: string }
): { installerSha256: string; installerUrl: string; productCode: string; version: string }
