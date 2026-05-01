import { APP_VERSION } from '../../config/env';
import { changelogMarkdown } from '../../content/changelog';

export default function UpdatesPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Updates</h1>
      <div className="rounded border bg-white p-4 text-sm">Current Version: {APP_VERSION}</div>
      <pre className="overflow-auto rounded border bg-white p-4 text-xs">{changelogMarkdown}</pre>
    </div>
  );
}
