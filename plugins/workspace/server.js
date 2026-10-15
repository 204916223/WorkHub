import { workspaceManifest } from './manifest.js'

export class WorkspacePlugin {
  manifest = workspaceManifest
  activate(context) {
    const workspace = context.services.get('workspace')
    context.aiTools.register({
      name: 'workspace_get_info', description: '查询当前 WorkHub 工作区与可用能力。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read', pluginId: this.manifest.id,
      validate(input) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('此工具不接受参数。') },
      async execute(_input, { signal }) { signal.throwIfAborted(); return workspace.info() },
    })
  }
  deactivate() {}
}
