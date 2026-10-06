/**
 * The permissions manifest each skill version declares.
 *
 * The manifest states what a skill needs from its sandbox. The sandbox enforces
 * it at launch, and a skill can never be granted more than the agent's sandbox
 * profile allows. Every field defaults to the most restrictive value so an
 * empty manifest means "no network, no writes, no extra commands".
 */
import { z } from 'zod';

/** Current manifest format version. Bump it when the shape changes. */
export const SKILL_PERMISSIONS_MANIFEST_VERSION = 1;

/** A lowercase hostname, optionally with a leading `*.` wildcard. */
const HOSTNAME_PATTERN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A bare executable name such as `git` or `npm`, never a path. */
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Path segment that would escape the sandbox workspace. */
const PARENT_DIRECTORY_SEGMENT = '..';

/**
 * Reports whether a path stays inside the sandbox workspace: relative, and with
 * no `..` segments.
 *
 * @param path - A path relative to the sandbox workspace root.
 * @returns `true` if the path cannot escape the workspace.
 */
function isWorkspaceRelativePath(path: string): boolean {
  const isAbsolute = path.startsWith('/') || path.startsWith('\\');
  const hasParentSegment = path.split(/[\\/]/).includes(PARENT_DIRECTORY_SEGMENT);
  return path.length > 0 && !isAbsolute && !hasParentSegment;
}

/** A lowercase hostname such as `registry.npmjs.org`, or a wildcard like `*.github.com`. */
export const HostnameSchema = z.string().regex(HOSTNAME_PATTERN, 'Must be a lowercase hostname');

/** A path relative to the sandbox workspace that cannot escape it. */
export const WorkspacePathSchema = z.string().refine(isWorkspaceRelativePath, {
  message: 'Must be a relative path inside the workspace with no ".." segments',
});

/** A bare command name such as `git`, never a path. */
export const CommandNameSchema = z
  .string()
  .regex(COMMAND_NAME_PATTERN, 'Must be a bare command name, not a path');

const NetworkPermissionsSchema = z
  .strictObject({
    isAllowed: z.boolean().default(false),
    allowedHosts: z.array(HostnameSchema).default([]),
  })
  .refine((network) => network.isAllowed || network.allowedHosts.length === 0, {
    message: 'allowedHosts requires isAllowed to be true',
    path: ['allowedHosts'],
  });

const FilesystemPermissionsSchema = z.strictObject({
  writablePaths: z.array(WorkspacePathSchema).default([]),
});

const CommandPermissionsSchema = z.strictObject({
  allowedCommands: z.array(CommandNameSchema).default([]),
});

/**
 * Validates a skill version's permissions manifest.
 *
 * Unknown keys are rejected so a skill cannot smuggle in permissions the
 * sandbox does not know how to enforce.
 *
 * @example
 * ```ts
 * SkillPermissionsManifestSchema.parse({
 *   manifestVersion: 1,
 *   network: { isAllowed: true, allowedHosts: ['registry.npmjs.org'] },
 *   commands: { allowedCommands: ['npm'] },
 * });
 * ```
 */
export const SkillPermissionsManifestSchema = z.strictObject({
  manifestVersion: z.literal(SKILL_PERMISSIONS_MANIFEST_VERSION),
  network: NetworkPermissionsSchema.default({ isAllowed: false, allowedHosts: [] }),
  filesystem: FilesystemPermissionsSchema.default({ writablePaths: [] }),
  commands: CommandPermissionsSchema.default({ allowedCommands: [] }),
});

/** A validated manifest with every default filled in. */
export type SkillPermissionsManifest = z.output<typeof SkillPermissionsManifestSchema>;

/** A manifest as authored, where omitted sections fall back to defaults. */
export type SkillPermissionsManifestInput = z.input<typeof SkillPermissionsManifestSchema>;
