import { splitPlainWorkspaceFileLinks } from '#~/utils/link-targets'

export const createPlainWorkspaceFileLinkPlugin = () => (tree: any) => {
  const visitChildren = (node: any) => {
    if (node == null || !Array.isArray(node.children)) return
    if (node.type === 'link' || node.type === 'image' || node.type === 'code' || node.type === 'inlineCode') return

    node.children = node.children.flatMap((child: any) => {
      if (child?.type !== 'text' || typeof child.value !== 'string') {
        visitChildren(child)
        return [child]
      }

      const segments = splitPlainWorkspaceFileLinks(child.value)
      if (segments.length === 1 && segments[0]?.type === 'text') {
        return [child]
      }

      return segments.map(segment =>
        segment.type === 'link'
          ? {
            type: 'link',
            url: segment.href,
            title: null,
            children: [{ type: 'text', value: segment.text }]
          }
          : { type: 'text', value: segment.text }
      )
    })
  }

  visitChildren(tree)
}
