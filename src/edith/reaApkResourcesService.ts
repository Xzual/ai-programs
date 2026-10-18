import { ReaContractError, validateReaApktoolClientEvidence, type ReaLocalFlowContext, type ReaLocalFlowResult } from './reaContract';
import { asRecord, checkedEvidence, digestCheck, flowResult, invalid, invokeRea, reaFact, schema } from './reaAppPackageService';

const clientCheck = schema.object({ command: schema.string(1), command_source: schema.enum(['environment', 'path']), apktool_version: schema.nullable(schema.string(1)) });
const decodeCheck = schema.object({ client: clientCheck, target: schema.object({ path: schema.string(), bytes: schema.number(), sha256: digestCheck }), metadata: schema.object({ version_name: schema.nullable(schema.string()), version_code: schema.nullable(schema.string()), min_sdk_version: schema.nullable(schema.string()), target_sdk_version: schema.nullable(schema.string()), package_name: schema.nullable(schema.string()) }), manifest: schema.nullable(schema.string()), strings: schema.array(schema.object({ name: schema.string(1), value: schema.string() }), 0, 2000), locale: schema.nullable(schema.string()), locales: schema.array(schema.string(1)), decoded_file_count: schema.number(), coverage: schema.enum(['complete', 'partial']) });
export function validReaAndroidLocale(value: unknown): boolean {
  return typeof value === 'string' && value.length >= 2 && value.length <= 16
    && /^(?:[a-z]{2,3}(?:-(?:r?[A-Z]{2}|r?[0-9]{3}))?|b\+[a-z]{2,3}(?:\+[A-Za-z0-9]{2,8})*)$/u.test(value)
    && !['car', 'desk', 'television', 'appliance', 'watch', 'vrheadset', 'night', 'notnight'].includes(value.toLowerCase());
}
function supportedVersion(version: string): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z0-9.-]+))?(?:\+[A-Za-z0-9.-]+)?$/.exec(version);
  if (!parts) return false;
  const major = Number(parts[1]), minor = Number(parts[2]), patch = Number(parts[3]);
  return major > 2 || (major === 2 && (minor > 7 || (minor === 7 && (patch > 0 || (patch === 0 && !parts[4])))));
}
export async function runReaApkResources(ctx: ReaLocalFlowContext): Promise<ReaLocalFlowResult> {
  ctx.assertCurrent(); const config = ctx.configuration.apkResources;
  if (!config?.qualificationRef || !config.javaQualified || !supportedVersion(config.launcherVersion) || !['environment', 'path'].includes(config.launcherSource)) throw new ReaContractError('REA_CONFIGURATION_REQUIRED');
  if (ctx.input.profile !== 'apk-resources') throw new ReaContractError('REA_INPUT_INVALID');
  const options = asRecord(ctx.input.profileOptions ?? {});
  schema.object({}, { includeStrings: schema.boolean, locale: value => { if (!validReaAndroidLocale(value)) throw new ReaContractError('REA_INPUT_INVALID'); } })(options);
  const clientBody = await invokeRea(ctx, 'inspect_apktool_client', {});
  const probe = validateReaApktoolClientEvidence(clientBody, { version: config.launcherVersion });
  schema.object({ client: clientCheck })(clientBody.normalized_result);
  const client = asRecord(asRecord(clientBody.normalized_result).client);
  if (client.command_source !== config.launcherSource || client.apktool_version !== config.launcherVersion) invalid();
  const includeStrings = options.includeStrings ?? true;
  const parameters = { path: ctx.targetPath, include_strings: includeStrings, ...(options.locale === undefined ? {} : { locale: options.locale }) };
  const body = await invokeRea(ctx, 'decode_android_resources', parameters);
  const evidence = checkedEvidence(body, ctx, 'decode_android_resources'); const row = asRecord(body.normalized_result); decodeCheck(row);
  schema.object(Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, schema.literal(value)])))(body.parameters);
  const actualClient = asRecord(row.client), identity = asRecord(body.provider);
  if (identity.id !== 'apktool' || identity.name !== 'Apktool' || identity.version !== config.launcherVersion || actualClient.apktool_version !== config.launcherVersion || actualClient.command_source !== config.launcherSource || actualClient.command !== client.command || asRecord(row.target).sha256 !== ctx.targetSha256 || row.locale !== (options.locale ?? null) || (!includeStrings && (row.strings as unknown[]).length)) invalid();
  const facts = [reaFact(probe, 'apktool_version', 'Qualified Apktool version', config.launcherVersion, 'client/apktool_version'), reaFact(evidence, 'apk_decoded_files', 'Decoded resource files', row.decoded_file_count as number, 'decoded_file_count'), reaFact(evidence, 'apk_string_entries', 'Decoded selected string entries', (row.strings as unknown[]).length, 'strings'), reaFact(evidence, 'apk_string_locales', 'Observed string locales', (row.locales as unknown[]).length, 'locales'), reaFact(evidence, 'apk_manifest_available', 'Decoded manifest available', row.manifest !== null, 'manifest')];
  ctx.assertCurrent(); return flowResult(evidence, facts, row.coverage === 'complete' ? 'complete' : 'partial', 'analysis', [probe.originalEvidenceId, evidence.originalEvidenceId]);
}
