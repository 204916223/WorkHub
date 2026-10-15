// Adapted from the local BehaviorTreeTools Host; Web workspace lifecycle owned by WorkHub.
export type PluginManifest = {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  apiVersion?: 1;
  views?: Array<{ id: string; title: string; subtitle: string; icon: string; color: string }>;
  defaultEnabled: boolean;
  dependencies?: string[];
  optionalDependencies?: string[];
  capabilities?: string[];
};
