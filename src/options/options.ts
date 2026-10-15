import './options.css';
import { renderRuntimeSyncReport, runtimeSyncMessage } from '../shared/runtime-sync';
import type { RuntimeSyncReport } from '../shared/types';
import {
  DEFAULT_CANVAS,
  createInitialConfig,
  getTimezoneOffsetMinutes,
  normalizeConfig,
  normalizeGeolocation,
  normalizeLanguage,
  normalizeTimezone,
  normalizeWebRtc
} from '../shared/config-model';
import { formatCoordinate } from '../shared/last-location-display';
import { createCustomProfile } from '../shared/profile';
import { ruleListToText, rulesFromText } from '../shared/rule-list';
import { renderSetupStatus } from '../shared/ui-state';
import type {
  ExitLocationDetectionPreview,
  ExitLocationProfile,
  Profile,
  SiteSpoofConfig
} from '../shared/types';

let currentConfig: SiteSpoofConfig = createInitialConfig();

const runtimeSyncStatusEl = document.getElementById('runtimeSyncStatus') as HTMLElement;
const retryRuntimeSyncBtn = document.getElementById('retryRuntimeSync') as HTMLButtonElement;
const setupStatusEl = document.getElementById('setupStatus') as HTMLElement;
const onboardingProfileEl = document.getElementById('onboardingProfile') as HTMLSelectElement;
const onboardingDomainsEl = document.getElementById('onboardingDomains') as HTMLTextAreaElement;
const onboardingWebRtcEl = document.getElementById('onboardingWebRtc') as HTMLSelectElement;
const onboardingConfirmEl = document.getElementById('onboardingConfirm') as HTMLInputElement;
const onboardingStatusEl = document.getElementById('onboardingStatus') as HTMLElement;
const onboardingDetailsEl = document.getElementById('onboardingDetails') as HTMLDetailsElement;
let onboardingPending = false;
let onboardingLoaded = false;

const globalEnabledEl = document.getElementById('globalEnabled') as HTMLInputElement;
const debugModeEl = document.getElementById('debugMode') as HTMLInputElement;
const ruleListEl = document.getElementById('ruleList') as HTMLTextAreaElement;
const geolocationEnabledEl = document.getElementById('geolocationEnabled') as HTMLInputElement;
const latitudeEl = document.getElementById('latitude') as HTMLInputElement;
const longitudeEl = document.getElementById('longitude') as HTMLInputElement;
const accuracyEl = document.getElementById('accuracy') as HTMLInputElement;
const randomizeEl = document.getElementById('randomize') as HTMLInputElement;
const randomRadiusMetersEl = document.getElementById('randomRadiusMeters') as HTMLInputElement;
const spoofPermissionEl = document.getElementById('spoofPermission') as HTMLInputElement;
const detectExitLocationBtn = document.getElementById('detectExitLocation') as HTMLButtonElement;
const exitLocationProfilesEl = document.getElementById('exitLocationProfiles') as HTMLElement;
const intlModeEl = document.getElementById('intlMode') as HTMLSelectElement;
const timezoneEnabledEl = document.getElementById('timezoneEnabled') as HTMLInputElement;
const timezoneEl = document.getElementById('timezone') as HTMLInputElement;
const utcOffsetEl = document.getElementById('utcOffset') as HTMLInputElement;
const languageEnabledEl = document.getElementById('languageEnabled') as HTMLInputElement;
const languageEl = document.getElementById('language') as HTMLInputElement;
const languagesEl = document.getElementById('languages') as HTMLInputElement;
const acceptLanguageEl = document.getElementById('acceptLanguage') as HTMLInputElement;
const webrtcEnabledEl = document.getElementById('webrtcEnabled') as HTMLInputElement;
const webrtcPolicyEl = document.getElementById('webrtcPolicy') as HTMLSelectElement;
const webrtcPolicyStatusEl = document.getElementById('webrtcPolicyStatus') as HTMLElement;
const canvasEnabledEl = document.getElementById('canvasEnabled') as HTMLInputElement;
const canvasSpoofFontsEl = document.getElementById('canvasSpoofFonts') as HTMLInputElement;
const canvasTargetFontsEl = document.getElementById('canvasTargetFonts') as HTMLTextAreaElement;
const resetFontsBtn = document.getElementById('resetFonts') as HTMLButtonElement;
const customProfilesEl = document.getElementById('customProfiles') as HTMLElement;
const siteRulesEl = document.getElementById('siteRules') as HTMLElement;
const exportConfigBtn = document.getElementById('exportConfig') as HTMLButtonElement;
const importConfigBtn = document.getElementById('importConfig') as HTMLButtonElement;
const importFileEl = document.getElementById('importFile') as HTMLInputElement;
const resetAllBtn = document.getElementById('resetAll') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const saveFooterBtn = document.getElementById('saveFooter') as HTMLButtonElement;
const saveAsCustomBtn = document.getElementById('saveAsCustom') as HTMLButtonElement;
const saveProfileModal = document.getElementById('saveProfileModal') as HTMLElement;
const newProfileNameEl = document.getElementById('newProfileName') as HTMLInputElement;
const newProfileDescriptionEl = document.getElementById('newProfileDescription') as HTMLInputElement;
const confirmSaveProfileBtn = document.getElementById('confirmSaveProfile') as HTMLButtonElement;
const cancelSaveProfileBtn = document.getElementById('cancelSaveProfile') as HTMLButtonElement;

function sendRuntimeMessage<T = any>(message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.status === 'error') {
        reject(new Error(response?.message || '扩展后台返回未知错误'));
        return;
      }
      const report = response.syncReport || response.state?.syncReport;
      if (report) renderRuntimeSyncReport(runtimeSyncStatusEl, report);
      // getWebRtcConfig.state.config 只是局部 WebRtcConfig，不能投影为完整配置。
      const config = response.config || (message.action === 'getExtensionState' || message.action === 'getCurrentTabState' ? response.state?.config : undefined);
      if (config) renderSetupStatus(setupStatusEl, normalizeConfig(config), report);
      resolve(response);
    });
  });
}

function showOperationError(error: unknown): void {
  runtimeSyncStatusEl.textContent = `操作结果未确认：${error instanceof Error ? error.message : String(error)}`;
  runtimeSyncStatusEl.dataset.status = 'failed';
}

function runUiTask(task: Promise<unknown>): void { void task.catch(showOperationError); }

async function retryRuntimeSync(): Promise<void> {
  retryRuntimeSyncBtn.disabled = true;
  try { await sendRuntimeMessage({ action: 'reconcileRuntime' }); }
  finally { retryRuntimeSyncBtn.disabled = false; }
}

function webRtcSelectValue(config: SiteSpoofConfig): string {
  if (config.webRtc.globalMode === 'strict') return 'disable_non_proxied_udp';
  if (config.webRtc.globalMode === 'compatible') return 'default_public_interface_only';
  return 'default';
}

function populateForm(config: SiteSpoofConfig): void {
  globalEnabledEl.checked = config.masterEnabled;
  debugModeEl.checked = config.debugMode;
  intlModeEl.value = config.intlMode;
  ruleListEl.value = ruleListToText(config.rules);

  const geo = config.globalProfile.geolocation;
  geolocationEnabledEl.checked = geo.enabled;
  latitudeEl.value = geo.latitude === null ? '' : String(geo.latitude);
  longitudeEl.value = geo.longitude === null ? '' : String(geo.longitude);
  accuracyEl.value = String(geo.accuracy);
  randomizeEl.checked = geo.randomize;
  randomRadiusMetersEl.value = String(geo.randomRadiusMeters);
  spoofPermissionEl.checked = geo.spoofPermission;

  const timezone = config.globalProfile.timezone;
  timezoneEnabledEl.checked = timezone.enabled;
  timezoneEl.value = timezone.timezone;
  const offset = timezone.timezone ? getTimezoneOffsetMinutes(timezone.timezone) : null;
  utcOffsetEl.value = offset === null ? '' : String(-offset / 60);

  const language = config.globalProfile.language;
  languageEnabledEl.checked = language.enabled;
  languageEl.value = language.language;
  languagesEl.value = language.languages.join(', ');
  acceptLanguageEl.value = language.acceptLanguage;

  webrtcEnabledEl.checked = config.webRtc.globalMode !== 'default';
  webrtcPolicyEl.value = webRtcSelectValue(config);
  canvasEnabledEl.checked = config.canvas.enabled;
  canvasSpoofFontsEl.checked = config.canvas.spoofFonts;
  canvasTargetFontsEl.value = config.canvas.targetFonts.join('\n');
  latitudeEl.placeholder = geo.mode === 'auto' ? '由站点选择的出口档案提供' : '';
  longitudeEl.placeholder = geo.mode === 'auto' ? '由站点选择的出口档案提供' : '';
  timezoneEl.placeholder = timezone.mode === 'auto' ? '由站点选择的出口档案提供' : 'UTC';

  renderProfiles();
  renderExitLocationProfiles();
  renderSiteRules();
  renderOnboarding();
}

function renderOnboarding(): void {
  if (!onboardingLoaded) {
    onboardingDetailsEl.open = !currentConfig.masterEnabled && !currentConfig.rules.length;
    onboardingLoaded = true;
  }
  const selected = onboardingProfileEl.value;
  onboardingProfileEl.innerHTML = '';
  onboardingProfileEl.append(new Option('请选择已检测并确认的出口', ''));
  currentConfig.exitLocationProfiles.filter((profile) => profile.verification === 'verified')
    .forEach((profile) => onboardingProfileEl.append(new Option(profile.name, profile.id)));
  onboardingProfileEl.value = currentConfig.exitLocationProfiles.some((profile) => profile.id === selected && profile.verification === 'verified') ? selected : '';
}

async function submitOnboarding(skip = false): Promise<void> {
  if (onboardingPending || confirmSaveProfileBtn.disabled) return;
  if (!skip && (!onboardingConfirmEl.checked || !onboardingProfileEl.value || !onboardingDomainsEl.value.trim())) {
    onboardingStatusEl.textContent = '请先检测并确认出口，选择站点，并勾选明确启用。';
    return;
  }
  onboardingPending = true;
  const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea'));
  const disabled = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  try {
    const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({
      action: skip ? 'skipOnboarding' : 'completeOnboarding',
      domains: onboardingDomainsEl.value, profileId: onboardingProfileEl.value,
      webRtcMode: onboardingWebRtcEl.value, confirmed: onboardingConfirmEl.checked
    });
    currentConfig = normalizeConfig(response.config);
    populateForm(currentConfig);
    onboardingConfirmEl.checked = false;
    onboardingStatusEl.textContent = `${skip ? '已跳过，保护关闭；已保存的档案和规则保留。' : '引导配置已保存。'} ${runtimeSyncMessage(response.syncReport)}`;
    // 跳过只收起当前页面；不创建另一份持久化引导状态。
    if (skip && response.syncReport.status === 'ok') onboardingDetailsEl.open = false;
    await loadWebRtcPolicyState();
  } catch (error) {
    onboardingStatusEl.textContent = `操作未完成：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    onboardingPending = false;
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
  }
}

function readForm(): SiteSpoofConfig {
  return normalizeConfig({
    ...currentConfig,
    masterEnabled: globalEnabledEl.checked,
    debugMode: debugModeEl.checked,
    intlMode: intlModeEl.value as SiteSpoofConfig['intlMode'],
    rules: rulesFromText(ruleListEl.value, currentConfig.rules),
    globalProfile: {
      language: normalizeLanguage({
        enabled: languageEnabledEl.checked,
        mode: 'custom',
        language: languageEl.value,
        languages: languagesEl.value.split(',').map((item) => item.trim()).filter(Boolean),
        acceptLanguage: acceptLanguageEl.value
      }),
      timezone: normalizeTimezone({
        enabled: timezoneEnabledEl.checked,
        mode: timezoneEl.value ? 'manual' : 'auto',
        timezone: timezoneEl.value
      }),
      geolocation: normalizeGeolocation({
        enabled: geolocationEnabledEl.checked,
        mode: latitudeEl.value && longitudeEl.value ? 'manual' : 'auto',
        latitude: latitudeEl.value === '' ? null : Number(latitudeEl.value),
        longitude: longitudeEl.value === '' ? null : Number(longitudeEl.value),
        accuracy: Number(accuracyEl.value),
        country: currentConfig.globalProfile.geolocation.country,
        randomize: randomizeEl.checked,
        randomRadiusMeters: Number(randomRadiusMetersEl.value),
        spoofPermission: spoofPermissionEl.checked,
        history: currentConfig.globalProfile.geolocation.history
      })
    },
    webRtc: webrtcEnabledEl.checked ? normalizeWebRtc({ policy: webrtcPolicyEl.value }) : normalizeWebRtc({ globalMode: 'default' }),
    canvas: {
      enabled: canvasEnabledEl.checked,
      spoofFonts: canvasSpoofFontsEl.checked,
      targetFonts: canvasTargetFontsEl.value.split('\n').map((item) => item.trim()).filter(Boolean)
    }
  });
}

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({ action: 'getSiteConfig' });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
  await loadWebRtcPolicyState();
}

async function loadWebRtcPolicyState(): Promise<void> {
  try {
    const response = await sendRuntimeMessage<{ state: { effectivePolicy: string | null; policyState?: { actualPolicy?: string | null; levelOfControl?: string | null; leakProtectionActive?: boolean } } }>({ action: 'getWebRtcConfig' });
    const state = response.state;
    webrtcPolicyStatusEl.textContent = [
      `请求策略：${state.effectivePolicy || 'default'}`,
      `浏览器实际：${state.policyState?.actualPolicy || 'unknown'}`,
      `控制级别：${state.policyState?.levelOfControl || 'unknown'}`
    ].join(' · ');
  } catch (error) {
    webrtcPolicyStatusEl.textContent = `当前策略状态：读取失败（${error instanceof Error ? error.message : String(error)}）`;
  }
}

async function saveSettings(config?: SiteSpoofConfig): Promise<void> {
  // 另存的显式候选是此期间唯一允许的完整配置提交。
  if (confirmSaveProfileBtn.disabled && config === undefined) return;
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({ action: 'setSiteConfig', config: config ?? readForm() });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
  alert(runtimeSyncMessage(response.syncReport));
}

async function applyProfile(profileId: string): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({ action: 'applyProfile', profileId });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
}

function createProfileCard(profile: Profile): HTMLElement {
  const card = document.createElement('div');
  card.className = 'profile-card';
  card.innerHTML = `
    <div class="profile-header">
      <div class="profile-info">
        <div class="profile-name"></div>
        <div class="profile-desc"></div>
      </div>
      <div class="profile-actions"></div>
    </div>
  `;
  card.querySelector('.profile-name')!.textContent = profile.name;
  card.querySelector('.profile-desc')!.textContent = `${profile.geolocation.latitude}, ${profile.geolocation.longitude} | ${profile.timezone.timezone}`;
  const applyBtn = document.createElement('button');
  applyBtn.className = 'btn-primary btn-sm';
  applyBtn.textContent = '应用';
  applyBtn.onclick = () => { runUiTask(applyProfile(profile.id)); };
  card.querySelector('.profile-actions')!.appendChild(applyBtn);
  return card;
}

function createCustomProfileCard(profile: Profile): HTMLElement {
  const card = createProfileCard(profile);
  const actions = card.querySelector('.profile-actions')!;
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn-secondary btn-sm';
  exportBtn.textContent = '导出';
  exportBtn.onclick = () => exportProfile(profile);
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger btn-sm';
  deleteBtn.textContent = '删除';
  deleteBtn.onclick = () => deleteProfile(profile.id);
  actions.append(exportBtn, deleteBtn);
  return card;
}

function renderProfiles(): void {
  customProfilesEl.innerHTML = '';
  const customProfiles = currentConfig.profile.profiles;
  if (!customProfiles.length) {
    customProfilesEl.innerHTML = '<p style="color: #888; font-size: 14px;">暂无自定义配置文件</p>';
    return;
  }
  customProfiles.forEach((profile) => customProfilesEl.appendChild(createCustomProfileCard(profile)));
}

function exitLocationSummary(profile: ExitLocationProfile): string {
  const status = profile.verification === 'verified' ? '已验证' : '待确认';
  return [
    status,
    profile.publicIp || 'IP 未验证',
    profile.country || '国家未知',
    profile.timezone || '时区未知',
    `${formatCoordinate(profile.latitude)}, ${formatCoordinate(profile.longitude)}`
  ].join(' · ');
}

async function cancelDetection(detectionId: string): Promise<void> {
  await sendRuntimeMessage({ action: 'cancelExitLocationDetection', detectionId });
}

async function confirmDetection(preview: ExitLocationDetectionPreview, name: string): Promise<void> {
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({
    action: 'confirmExitLocationDetection',
    detectionId: preview.detectionId,
    name
  });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
}

async function detectNewExitLocation(): Promise<void> {
  if (detectExitLocationBtn.disabled) return;
  detectExitLocationBtn.disabled = true;
  const onboardingDetect = document.getElementById('onboardingDetect') as HTMLButtonElement;
  onboardingDetect.disabled = true;
  try {
    const response = await sendRuntimeMessage<{ preview: ExitLocationDetectionPreview }>({ action: 'detectExitLocation' });
    const preview = response.preview;
    const candidate = preview.candidate;
    const accepted = confirm([
      '检测到新的出口位置：',
      `IP：${candidate.publicIp}`,
      `国家：${candidate.country}`,
      `时区：${candidate.timezone}`,
      `坐标：${formatCoordinate(candidate.latitude)}, ${formatCoordinate(candidate.longitude)}`,
      '',
      '是否创建出口位置档案？'
    ].join('\n'));
    if (!accepted) {
      await cancelDetection(preview.detectionId);
      return;
    }
    const name = prompt('出口位置档案名称', `${candidate.country} ${candidate.publicIp}`)?.trim();
    if (!name) {
      await cancelDetection(preview.detectionId);
      return;
    }
    await confirmDetection(preview, name);
  } catch (error) {
    alert(`检测出口位置失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    detectExitLocationBtn.disabled = false;
    onboardingDetect.disabled = false;
  }
}

async function redetectExitLocation(profile: ExitLocationProfile): Promise<void> {
  try {
    const response = await sendRuntimeMessage<{ preview: ExitLocationDetectionPreview }>({
      action: 'detectExitLocation',
      profileId: profile.id
    });
    const preview = response.preview;
    const candidate = preview.candidate;
    const accepted = confirm([
      `重新检测“${profile.name}”`,
      `IP：${profile.publicIp || '未验证'} → ${candidate.publicIp}`,
      `国家：${profile.country || '未知'} → ${candidate.country}`,
      `时区：${profile.timezone || '未知'} → ${candidate.timezone}`,
      `坐标：${formatCoordinate(profile.latitude)}, ${formatCoordinate(profile.longitude)} → ${formatCoordinate(candidate.latitude)}, ${formatCoordinate(candidate.longitude)}`,
      '',
      '确认后将原地更新该档案，引用规则继续使用同一 ID。'
    ].join('\n'));
    if (!accepted) {
      await cancelDetection(preview.detectionId);
      return;
    }
    await confirmDetection(preview, profile.name);
  } catch (error) {
    alert(`重新检测失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function renameExitLocation(profile: ExitLocationProfile): Promise<void> {
  const name = prompt('修改出口位置档案名称', profile.name)?.trim();
  if (!name || name === profile.name) return;
  try {
    const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({
      action: 'renameExitLocationProfile',
      profileId: profile.id,
      name
    });
    currentConfig = normalizeConfig(response.config);
    populateForm(currentConfig);
  } catch (error) {
    alert(`重命名失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function deleteExitLocation(profile: ExitLocationProfile): Promise<void> {
  if (!confirm(`确定删除出口位置档案“${profile.name}”吗？`)) return;
  try {
    const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({
      action: 'deleteExitLocationProfile',
      profileId: profile.id
    });
    currentConfig = normalizeConfig(response.config);
    populateForm(currentConfig);
  } catch (error) {
    alert(`删除失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderExitLocationProfiles(): void {
  exitLocationProfilesEl.innerHTML = '';
  if (!currentConfig.exitLocationProfiles.length) {
    exitLocationProfilesEl.innerHTML = '<p class="section-description">尚无出口位置档案。请先检测当前出口，再为站点规则显式选择。</p>';
    return;
  }
  currentConfig.exitLocationProfiles.forEach((profile) => {
    const card = document.createElement('div');
    card.className = 'profile-card';
    const info = document.createElement('div');
    info.className = 'profile-info';
    const name = document.createElement('strong');
    name.textContent = profile.name;
    const summary = document.createElement('small');
    summary.textContent = exitLocationSummary(profile);
    info.append(name, summary);
    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    const redetect = document.createElement('button');
    redetect.className = 'btn-primary btn-sm';
    redetect.textContent = profile.verification === 'verified' ? '重新检测' : '检测并确认';
    redetect.onclick = () => { runUiTask(redetectExitLocation(profile)); };
    const rename = document.createElement('button');
    rename.className = 'btn-secondary btn-sm';
    rename.textContent = '重命名';
    rename.onclick = () => { runUiTask(renameExitLocation(profile)); };
    const remove = document.createElement('button');
    remove.className = 'btn-danger btn-sm';
    remove.textContent = '删除';
    remove.onclick = () => { runUiTask(deleteExitLocation(profile)); };
    actions.append(redetect, rename, remove);
    card.append(info, actions);
    exitLocationProfilesEl.appendChild(card);
  });
}

function renderSiteRules(): void {
  siteRulesEl.innerHTML = '';
  if (!currentConfig.rules.length) {
    siteRulesEl.innerHTML = '<p style="color: #888; font-size: 14px;">暂无站点规则</p>';
    return;
  }
  currentConfig.rules.forEach((rule) => {
    const ruleEl = document.createElement('div');
    ruleEl.className = 'site-rule';
    const info = document.createElement('div');
    const hostnameEl = document.createElement('span');
    hostnameEl.className = 'site-hostname';
    hostnameEl.textContent = rule.domain;
    const statusEl = document.createElement('span');
    statusEl.className = `site-status ${rule.enabled ? 'enabled' : 'disabled'}`;
    statusEl.textContent = rule.enabled ? '已启用' : '已禁用';
    info.append(hostnameEl, statusEl);
    const profileSelect = document.createElement('select');
    profileSelect.className = 'input';
    profileSelect.setAttribute('aria-label', `${rule.domain} 的出口位置档案`);
    profileSelect.append(new Option('未选择出口', ''));
    currentConfig.exitLocationProfiles.forEach((profile) => {
      const label = `${profile.name}${profile.verification === 'verified' ? '' : '（待确认）'}`;
      const option = new Option(label, profile.id);
      option.disabled = profile.verification !== 'verified';
      profileSelect.append(option);
    });
    if (rule.exitLocationProfileId && !currentConfig.exitLocationProfiles.some((profile) => profile.id === rule.exitLocationProfileId)) {
      const missing = new Option(`引用不存在（${rule.exitLocationProfileId}）`, rule.exitLocationProfileId);
      missing.disabled = true;
      profileSelect.append(missing);
    }
    profileSelect.value = rule.exitLocationProfileId || '';
    profileSelect.onchange = () => {
      rule.exitLocationProfileId = profileSelect.value || null;
    };
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger btn-sm';
    deleteBtn.textContent = '删除';
    deleteBtn.onclick = () => {
      currentConfig.rules = currentConfig.rules.filter((item) => item.domain !== rule.domain);
      ruleListEl.value = ruleListToText(currentConfig.rules);
      renderSiteRules();
    };
    ruleEl.append(info, profileSelect, deleteBtn);
    siteRulesEl.appendChild(ruleEl);
  });
}

function openSaveAsCustomModal(): void {
  newProfileNameEl.value = '';
  newProfileDescriptionEl.value = '';
  saveProfileModal.classList.add('active');
}

function closeSaveAsCustomModal(): void {
  if (confirmSaveProfileBtn.disabled) return;
  saveProfileModal.classList.remove('active');
}

async function handleSaveAsCustom(): Promise<void> {
  if (confirmSaveProfileBtn.disabled) return;
  const pendingButtons = [confirmSaveProfileBtn, cancelSaveProfileBtn, saveBtn, saveFooterBtn, resetFontsBtn];
  pendingButtons.forEach((button) => { button.disabled = true; });
  try {
    const name = newProfileNameEl.value.trim();
    if (!name) {
      alert('请输入配置名称');
      return;
    }
    const draft = readForm();
    // 表单 accuracy 不经默认值修复，避免把非法输入保存成有效方案。
    draft.globalProfile.geolocation.accuracy = Number(accuracyEl.value);
    let profile: Profile;
    try {
      profile = createCustomProfile(draft, name, newProfileDescriptionEl.value);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      return;
    }
    await saveSettings({ ...draft, profile: {
      ...draft.profile,
      profiles: [...draft.profile.profiles, profile]
    } });
  } finally {
    pendingButtons.forEach((button) => { button.disabled = false; });
  }
  closeSaveAsCustomModal();
}

function exportProfile(profile: Profile): void {
  downloadJson(`vanishgeo-profile-${profile.id}-${Date.now()}.json`, profile);
}

function deleteProfile(profileId: string): void {
  if (!confirm('确定要删除这个配置文件吗？')) return;
  currentConfig.profile.profiles = currentConfig.profile.profiles.filter((profile) => profile.id !== profileId);
  renderProfiles();
}

function downloadJson(filename: string, value: unknown): void {
  const dataBlob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportConfiguration(): void {
  currentConfig = readForm();
  downloadJson(`vanishgeo-config-${Date.now()}.json`, currentConfig);
}

function importConfiguration(): void {
  importFileEl.click();
}

async function handleImportFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({
      action: 'importSiteConfig',
      config: JSON.parse(await file.text())
    });
    currentConfig = normalizeConfig(response.config);
    populateForm(currentConfig);
    alert(`${runtimeSyncMessage(response.syncReport)} 出口位置档案已降级为待确认，站点规则的出口绑定已清空。`);
  } catch (error) {
    alert(`导入配置失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    importFileEl.value = '';
  }
}

async function resetAllData(): Promise<void> {
  if (!confirm('清空全部配置、规则、出口档案和历史，取消待确认检测，关闭保护并恢复浏览器默认 WebRTC？此操作无法撤销。')) return;
  const response = await sendRuntimeMessage<{ config: SiteSpoofConfig; syncReport: RuntimeSyncReport }>({ action: 'resetSiteConfig' });
  currentConfig = normalizeConfig(response.config);
  populateForm(currentConfig);
  onboardingDetailsEl.open = true;
  onboardingDomainsEl.value = '';
  onboardingWebRtcEl.value = 'default';
  onboardingStatusEl.textContent = '已重置为安全关闭默认值。请重新检测并配置；下载文件和外部站点数据不受影响。';
  onboardingConfirmEl.checked = false;
  await loadWebRtcPolicyState();
}

async function handleResetFonts(): Promise<void> {
  if (confirmSaveProfileBtn.disabled) return;
  currentConfig.canvas.targetFonts = DEFAULT_CANVAS.targetFonts;
  canvasTargetFontsEl.value = DEFAULT_CANVAS.targetFonts.join('\n');
  await saveSettings();
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetTab = (btn as HTMLElement).dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.tab-content[data-tab="${targetTab}"]`)?.classList.add('active');
  });
});

saveBtn.addEventListener('click', () => { runUiTask(saveSettings()); });
saveFooterBtn.addEventListener('click', () => { runUiTask(saveSettings()); });
saveAsCustomBtn.addEventListener('click', openSaveAsCustomModal);
confirmSaveProfileBtn.addEventListener('click', () => { runUiTask(handleSaveAsCustom()); });
cancelSaveProfileBtn.addEventListener('click', closeSaveAsCustomModal);
detectExitLocationBtn.addEventListener('click', () => { runUiTask(detectNewExitLocation()); });
canvasEnabledEl.addEventListener('change', () => { currentConfig = readForm(); populateForm(currentConfig); });
canvasSpoofFontsEl.addEventListener('change', () => { currentConfig = readForm(); populateForm(currentConfig); });
resetFontsBtn.addEventListener('click', () => { runUiTask(handleResetFonts()); });
exportConfigBtn.addEventListener('click', exportConfiguration);
importConfigBtn.addEventListener('click', importConfiguration);
importFileEl.addEventListener('change', (event) => { runUiTask(handleImportFile(event)); });
resetAllBtn.addEventListener('click', () => { runUiTask(resetAllData()); });
saveProfileModal.addEventListener('click', (event) => {
  if (event.target === saveProfileModal) closeSaveAsCustomModal();
});

runUiTask(loadConfig());

retryRuntimeSyncBtn.addEventListener('click', () => { runUiTask(retryRuntimeSync()); });
document.getElementById('onboardingDetect')!.addEventListener('click', () => { runUiTask(detectNewExitLocation()); });
document.getElementById('onboardingEnable')!.addEventListener('click', () => { runUiTask(submitOnboarding()); });
document.getElementById('onboardingSkip')!.addEventListener('click', () => { runUiTask(submitOnboarding(true)); });
