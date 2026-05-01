import { useState } from 'react';
import { APP_VERSION } from '../../config/env';
import { aiPromptContent } from '../../content/aiPrompt';

export default function AiPromptPage() {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await navigator.clipboard.writeText(aiPromptContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">AI Prompt</h1>
        <div className="text-sm text-gray-600">Version {APP_VERSION}</div>
      </div>
      <button className="rounded bg-blue-600 px-3 py-2 text-white" onClick={onCopy} type="button">
        {copied ? 'Copied' : 'Copy Prompt'}
      </button>
      <pre className="overflow-auto rounded border bg-white p-4 text-xs">{aiPromptContent}</pre>
    </div>
  );
}
