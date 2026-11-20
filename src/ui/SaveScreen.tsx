import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { touchFirst } from '../game/options';
import type { SaveData } from '../game/persistence';
import { backupFile, decodeSave, encodeSave, formatDay, restoreFrom, saveSummary, type CodeProblem, type SaveSummary } from '../game/saveCode';
import { desktop } from '../desktop';
import { Shard } from './art';
import { useInstall } from './install';
import { useKept } from './keep';

const PROBLEMS: Record<CodeProblem, string> = {
  none: 'That isn’t a backup code.',
  cut: 'That code is cut off; copy all of it.',
  bad: 'That code is damaged.',
  newer: 'That backup is from a newer version of the game. Reload to update.',
};

/** A file named like the backups, or any text file: what's in it is read as a code. */
const FILE_TYPES = '.txt,text/plain';

/** Saves the backup file: the share sheet on a phone or tablet (Files, Drive, or a message to yourself), a download elsewhere. Resolves to whether it went anywhere. */
async function saveFile(name: string, text: string): Promise<boolean> {
  const file = new File([text], name, { type: 'text/plain' });
  if (touchFirst() && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Serpent Sorcery save' });
      return true;
    } catch (e) {
      // Closing the share sheet isn't a failure; anything else falls back to a download.
      if (e instanceof DOMException && e.name === 'AbortError') return false;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

function Summary({ s }: { s: SaveSummary }) {
  return (
    <span className="save-sum">
      <span className="shards">
        {s.shards.toLocaleString('en-US')} <Shard />
      </span>{' '}
      · {s.runs.toLocaleString('en-US')} {s.runs === 1 ? 'run' : 'runs'} · {s.wins} {s.wins === 1 ? 'win' : 'wins'} · {s.achievements}/{s.of} achievements
    </span>
  );
}

type Step = { kind: 'main' } | { kind: 'paste' } | { kind: 'show'; code: string } | { kind: 'confirm'; backup: SaveData; made: string };

/**
 * Backup & Restore, from the Options screen: whether the browser keeps the save, a backup as a
 * code to copy or a file to keep, and restoring one, which replaces this device's progress and
 * keeps its options. A restore can be undone until the screen is left.
 */
export function SaveScreen({
  save,
  stored,
  onRestore,
  onBackedUp,
  onBack,
}: {
  save: SaveData;
  /** The last write to storage worked. */
  stored: boolean;
  onRestore(next: SaveData): void;
  onBackedUp(): void;
  onBack(): void;
}) {
  const kept = useKept();
  const install = useInstall();
  const [step, setStep] = useState<Step>({ kind: 'main' });
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [restoreNote, setRestoreNote] = useState<{ text: string; error: boolean } | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ save: SaveData; made: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toMain = useCallback(() => {
    setStep({ kind: 'main' });
    setPasteError(null);
  }, []);

  // Escape leaves a step, then the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.repeat) return;
      e.preventDefault();
      if (step.kind === 'main') onBack();
      else toMain();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step.kind, onBack, toMain]);

  const read = (text: string, from: 'paste' | 'file'): void => {
    const got = decodeSave(text);
    if (got.ok) {
      setPasteError(null);
      setRestoreNote(null);
      setStep({ kind: 'confirm', backup: got.save, made: got.made });
    } else if (from === 'paste') setPasteError(PROBLEMS[got.why]);
    else setRestoreNote({ text: got.why === 'none' ? 'That file has no backup code in it.' : PROBLEMS[got.why], error: true });
  };

  const copy = async () => {
    const code = encodeSave(save, new Date());
    try {
      await navigator.clipboard.writeText(code);
      onBackedUp();
      setBackupNote('Copied. Paste it somewhere safe, like a note or an email to yourself.');
    } catch {
      // No clipboard: the code, selected, to copy by hand.
      onBackedUp();
      setStep({ kind: 'show', code });
    }
  };

  const toFile = async () => {
    const f = backupFile(save, new Date());
    if (await saveFile(f.name, f.text)) {
      onBackedUp();
      setBackupNote(`Saved ${f.name}.`);
    }
  };

  const chosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      read(await file.text(), 'file');
    } catch {
      setRestoreNote({ text: 'That file couldn’t be read.', error: true });
    }
  };

  const replace = (backup: SaveData, made: string) => {
    setUndo({ save, made });
    onRestore(restoreFrom(save, backup));
    setRestoreNote(null);
    setStep({ kind: 'main' });
  };

  const undoRestore = () => {
    if (!undo) return;
    onRestore(undo.save);
    setUndo(null);
    setRestoreNote({ text: 'Undone: this device’s progress is back as it was.', error: false });
  };

  let status: ReactNode;
  const app = desktop();
  if (app) status = stored ? `Your save is kept on this computer.${app.steam.cloud ? ' Steam Cloud keeps a copy too.' : ''}` : 'The game couldn’t write its save file. Back up before you quit.';
  else if (!stored) status = 'This browser isn’t keeping anything right now (a private window, or storage turned off). Back up before you close it.';
  else if (kept === null) status = 'Checking whether this browser keeps your save…';
  else if (kept) status = 'This browser keeps your save for good.';
  else
    status = `This browser may clear your save on its own, when it’s short of space or, in Safari, after a week without a visit. Back it up to be safe.${install ? ' Installing the game helps too.' : ''}`;

  let body: ReactNode;
  if (step.kind === 'paste') {
    body = (
      <section className="options-section save-step" data-step="paste">
        <h3 className="setup-head">Paste a backup code</h3>
        <textarea
          className="save-code"
          value={pasted}
          onChange={(e) => {
            setPasted(e.target.value);
            setPasteError(null);
          }}
          placeholder="SS1:…~"
          aria-label="Backup code"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          autoFocus
        />
        <p className={`opt-note${pasteError ? ' save-error' : ''}`} role="status">
          {pasteError ?? (
            <>
              The whole code, from <code>SS1:</code> to the <code>~</code> at its end. Text around it is fine.
            </>
          )}
        </p>
        <div className="save-row">
          <button className="btn primary" data-save="read" onClick={() => read(pasted, 'paste')} disabled={!pasted.trim()}>
            Restore
          </button>
          <button className="btn" onClick={toMain}>
            Cancel
          </button>
        </div>
      </section>
    );
  } else if (step.kind === 'show') {
    body = (
      <section className="options-section save-step" data-step="show">
        <h3 className="setup-head">Your backup code</h3>
        <textarea className="save-code" value={step.code} readOnly aria-label="Backup code" onFocus={(e) => e.target.select()} autoFocus />
        <p className="opt-note">This browser won’t copy it by itself: select it all and copy it, then keep it somewhere safe.</p>
        <div className="save-row">
          <button className="btn primary" onClick={toMain}>
            Done
          </button>
        </div>
      </section>
    );
  } else if (step.kind === 'confirm') {
    const here = saveSummary(save);
    const there = saveSummary(step.backup);
    body = (
      <section className="options-section save-step" data-step="confirm">
        <h3 className="setup-head">Replace this device’s progress with the backup?</h3>
        <dl className="save-compare">
          <div>
            <dt>This device</dt>
            <dd>
              <Summary s={here} />
            </dd>
          </div>
          <div>
            <dt>{step.made ? `Backup, made ${formatDay(step.made)}` : 'Backup'}</dt>
            <dd>
              <Summary s={there} />
            </dd>
          </div>
        </dl>
        {there.runs < here.runs && (
          <p className="opt-note save-error" data-save="fewer">
            This backup has fewer runs than this device. Restoring it loses the difference.
          </p>
        )}
        <p className="opt-note">Your options here stay as they are.</p>
        <div className="save-row">
          <button className="btn primary" data-save="replace" onClick={() => replace(step.backup, step.made)}>
            Replace
          </button>
          <button className="btn" onClick={toMain}>
            Cancel
          </button>
        </div>
      </section>
    );
  } else {
    body = (
      <>
        <section className="options-section save-state">
          <p className="save-now">
            <Summary s={saveSummary(save)} />
          </p>
          <p className="opt-note" data-save="status" data-kept={kept === null ? 'checking' : String(kept && stored)}>
            {status}
            {save.backup.last && ` Last backed up ${formatDay(save.backup.last)}.`}
          </p>
          {undo && (
            <p className="opt-note save-restored" role="status">
              Restored the backup{undo.made ? ` made ${formatDay(undo.made)}` : ''}.{' '}
              <button className="btn small" data-save="undo" onClick={undoRestore}>
                Undo
              </button>
            </p>
          )}
        </section>
        <section className="options-section save-part">
          <h3 className="setup-head">Back up</h3>
          <div className="save-row">
            <button className="btn" data-save="copy" onClick={() => void copy()}>
              Copy code
            </button>
            <button className="btn" data-save="file" onClick={() => void toFile()}>
              Save as file
            </button>
          </div>
          <p className="opt-note" role="status">
            {backupNote ?? 'Keep it somewhere safe, or use it to bring your progress to another device.'}
          </p>
        </section>
        <section className="options-section save-part">
          <h3 className="setup-head">Restore</h3>
          <div className="save-row">
            <button
              className="btn"
              data-save="paste"
              onClick={() => {
                setPasted('');
                setPasteError(null);
                setStep({ kind: 'paste' });
              }}
            >
              Paste code
            </button>
            <button className="btn" data-save="open" onClick={() => fileRef.current?.click()}>
              From a file
            </button>
          </div>
          <p className={`opt-note${restoreNote?.error ? ' save-error' : ''}`} role="status">
            {restoreNote?.text ?? 'Replaces this device’s progress. Your options here stay as they are.'}
          </p>
          <input ref={fileRef} type="file" accept={FILE_TYPES} hidden onChange={(e) => void chosen(e)} data-save="input" />
        </section>
      </>
    );
  }

  return (
    <div className="screen save-screen phone-menu">
      <h2 className="screen-title">Backup &amp; Restore</h2>
      <div className={`save-body phone-pane pane-on save-${step.kind}`}>{body}</div>
      <div className="menu-buttons row">
        <button className="btn primary" onClick={onBack}>
          Back <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
