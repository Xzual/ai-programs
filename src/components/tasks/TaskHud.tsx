import React from 'react';
import { Check, Circle, ExternalLink, ShieldCheck, SkipForward, X } from 'lucide-react';
import type { TaskHudModel } from './taskHudProjection';

export type TaskHudProps = {
  visible: boolean;
  model: TaskHudModel;
  onHide(reason: 'close-button' | 'keyboard'): void;
  onSelectTask(id: string): void;
  onOpenTasks(): void;
};

const taskStatus: Record<NonNullable<TaskHudModel['selected']>['status'], string> = {
  CREATED: 'Oluşturuldu', ANALYZING: 'İnceleniyor', QUEUED: 'Sırada', PLANNING: 'Planlanıyor',
  WAITING_DEPENDENCY: 'Bağımlılık bekleniyor', RUNNING: 'Çalışıyor', PAUSED: 'Duraklatıldı',
  RETRYING: 'Yeniden deneniyor', VERIFYING: 'Doğrulanıyor', WAITING_PERMISSION: 'İzin bekliyor',
  WAITING_FOR_APPROVAL: 'Onay bekliyor', BLOCKED: 'Engellendi', RECOVERING: 'Kurtarılıyor',
  COMPLETED: 'Tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi',
  ROLLING_BACK: 'Geri alınıyor', ROLLED_BACK: 'Geri alındı',
};

const stepStatus = {
  PENDING: 'Bekliyor', READY: 'Bekliyor', RUNNING: 'Çalışıyor',
  COMPLETED: 'Tamamlandı', FAILED: 'Başarısız', SKIPPED: 'Atlandı',
} as const;

const transportCopy: Record<TaskHudModel['surface'], string> = {
  loading: 'Durum yükleniyor', ready: 'Durum alındı', empty: 'Liste alındı',
  offline: 'Bağlantı yok', error: 'Durum alınamadı', reconnecting: 'Bağlantı yenileniyor',
};

const freshnessCopy: Record<TaskHudModel['freshness'], string> = {
  unchecked: 'Henüz kontrol edilmedi', snapshot: 'Son doğrulanan durum',
  refreshing: 'Yenileniyor · önceki kontrol', stale: 'Güncelliği doğrulanamadı',
};

function emptyCopy(model: TaskHudModel): string {
  if (model.selectionState === 'awaiting-link') return 'Görev bağlantısı bekleniyor';
  if (model.selectionState === 'unavailable') return 'Seçilen görev kullanılamıyor';
  if (model.surface === 'loading' || model.surface === 'reconnecting') return 'Görev durumu bekleniyor';
  if (model.surface === 'offline') return 'Görev için bağlantı bekleniyor';
  if (model.surface === 'error') return 'Görev durumu alınamadı';
  return 'Görev bulunamadı';
}

function checkedTime(timestamp: number | undefined): string | undefined {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return undefined;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function TaskHud({ visible, model, onHide, onSelectTask, onOpenTasks }: TaskHudProps) {
  if (!visible) return null;
  const selected = model.selected;
  const selectedIndex = model.choices.findIndex((choice) => choice.taskId === selected?.taskId);
  const runningRows = selected?.steps.filter((step) => step.status === 'RUNNING').length ?? 0;
  const time = checkedTime(model.lastSuccessfulReadAt);
  const verified = selected?.status === 'COMPLETED' && selected.verification === 'verified-success';

  return (
    <aside className="edith-task-hud" aria-label="Görev durumu">
      <header className="edith-task-hud__header">
        <div className="edith-task-hud__heading">
          <p className="edith-task-hud__label">{selected?.historical ? 'Son görev' : 'Görev'}</p>
          <h2 className="edith-task-hud__title">{selected?.safeTitle ?? emptyCopy(model)}</h2>
        </div>
        <button type="button" className="edith-task-hud__close" aria-label="Görev panelini gizle" onClick={() => onHide('close-button')}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>

      <div className="edith-task-hud__body">
        {selected && <>
          <p className={`edith-task-hud__status${verified ? ' edith-task-hud__status--verified' : ''}`}>
            {verified && <ShieldCheck size={15} aria-hidden="true" />}
            {verified ? 'Tamamlandı · doğrulandı' : selected.status === 'COMPLETED' ? 'Tamamlandı · doğrulama yok' : taskStatus[selected.status]}
          </p>
          {runningRows > 1 && <p className="edith-task-hud__note">{runningRows} paralel adım gösteriliyor</p>}
          {selected.steps.length > 0 ? <ol className="edith-task-hud__steps" aria-label="Görev adımları">
            {selected.steps.map((step, index) => (
              <li key={index} className={`edith-task-hud__step edith-task-hud__step--${step.status.toLowerCase()}`}>
                <span className="edith-task-hud__marker" aria-hidden="true">
                  {step.status === 'COMPLETED' ? <Check size={13} /> : step.status === 'SKIPPED' ? <SkipForward size={13} /> : step.status === 'FAILED' ? <X size={13} /> : <Circle size={step.status === 'RUNNING' ? 10 : 7} />}
                </span>
                <span className="edith-task-hud__step-content"><span>{step.safeTitle}</span><span className="edith-task-hud__step-state">{stepStatus[step.status]}</span></span>
              </li>
            ))}
          </ol> : <p className="edith-task-hud__note">Adım ayrıntısı henüz yok</p>}
          {selected.omittedStepCount > 0 && <p className="edith-task-hud__note">+{selected.omittedStepCount} adım · ayrıntılarda</p>}
          {selected.stepCounts && <p className="edith-task-hud__counts">
            {selected.stepCounts.completed}/{selected.stepCounts.total} adım tamamlandı
            {selected.stepCounts.skipped > 0 && <span>{selected.stepCounts.skipped} adım atlandı</span>}
            {selected.stepCounts.failed > 0 && <span>{selected.stepCounts.failed} adım başarısız</span>}
          </p>}
          {(selected.integrity === 'gap' || selected.integrity === 'snapshot-conflict') && <p className="edith-task-hud__attention">
            {selected.integrity === 'gap' ? 'Etkinlik geçmişi eksik' : 'Durum tutarlılığı doğrulanamadı'}
          </p>}
        </>}

        <div className="edith-task-hud__freshness">
          <p>{transportCopy[model.surface]}</p>
          <p>{freshnessCopy[model.freshness]}</p>
          {time && <p>Son kontrol {time} · 12 sn aralıkla</p>}
        </div>
        {model.fetchedListCounts && <p className="edith-task-hud__note">
          Alınan listede {model.fetchedListCounts.nonterminal} bitmemiş görev; {model.fetchedListCounts.running} çalışıyor
        </p>}
      </div>

      <footer className="edith-task-hud__footer">
        {model.choices.length > 1 && <label className="edith-task-hud__selection">
          <span>Görev seç</span>
          <select aria-label="Görev seç" value={selectedIndex < 0 ? '' : String(selectedIndex)} onChange={(event) => {
            if (!/^\d+$/.test(event.currentTarget.value)) return;
            const choice = model.choices[Number(event.currentTarget.value)];
            if (choice) onSelectTask(choice.taskId);
          }}>
            {selectedIndex < 0 && <option value="" disabled>Görev seç</option>}
            {model.choices.map((choice, index) => <option key={index} value={String(index)}>{choice.safeTitle}</option>)}
          </select>
        </label>}
        <button type="button" className="edith-task-hud__details" onClick={onOpenTasks}>Ayrıntılar <ExternalLink size={13} aria-hidden="true" /></button>
      </footer>
    </aside>
  );
}
