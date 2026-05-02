import { useReviewStore } from '../state/review-store';
import { DadMark } from './DadMark';
import { getAccentMeta } from '../lib/accents';

type Props = {
  message: string;
};

export function GeneratingScreen({ message }: Props) {
  const pr = useReviewStore((s) => s.pr);
  const files = useReviewStore((s) => s.files);
  const accent = useReviewStore((s) => s.accent);
  const commit = useReviewStore((s) => s.commit);
  const sourceType = useReviewStore((s) => s.sourceType);
  const { markBg } = getAccentMeta(accent);

  const isCommit = sourceType === 'commit' && commit;
  const title = isCommit ? commit.subject : pr?.title;
  const additions = isCommit ? commit.additions : pr?.additions;
  const deletions = isCommit ? commit.deletions : pr?.deletions;
  const author = isCommit ? commit.author.login : pr?.author?.login;
  const identifier = isCommit ? (
    <span className="font-mono font-normal text-[var(--fg-3)]">@{commit.shortSha}</span>
  ) : (
    <span className="font-normal text-[var(--fg-3)]">#{pr?.number}</span>
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-page)] px-6">
      <div className="flex flex-col items-center gap-6 text-center">
        <div style={{ animation: 'generating-bob 2s ease-in-out infinite' }}>
          <DadMark size={64} bg={markBg} shape="circle" showBadge={false} showWink />
        </div>

        {(pr || isCommit) && (
          <div className="space-y-1">
            <h1 className="m-0 text-[22px] font-bold tracking-tight text-[var(--fg-1)]">
              {identifier} {title}
            </h1>
            <div className="text-[13px] text-[var(--fg-3)]">
              <span style={{ color: 'var(--green-11)' }}>+{additions}</span>{' '}
              <span style={{ color: 'var(--red-11)' }}>-{deletions}</span>
              {' across '}
              {files.length} {files.length === 1 ? 'file' : 'files'}
              {' by '}
              <span className="font-medium text-[var(--fg-2)]">{author}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="generating-dots flex gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out infinite' }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out 0.2s infinite' }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out 0.4s infinite' }}
            />
          </div>
          <p
            className="text-[14px] italic text-[var(--fg-2)]"
            style={{ animation: 'generating-fade 2.5s ease-in-out infinite' }}
          >
            {message}
          </p>
        </div>
      </div>
    </main>
  );
}
