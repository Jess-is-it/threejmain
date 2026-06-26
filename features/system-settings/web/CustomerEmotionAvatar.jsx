import React from 'react';
import { customerAvatarViewModel } from './avatarEmotion';

export default function CustomerEmotionAvatar({
  customer,
  context = {},
  avatarConfig = null,
  size = 42,
  showLabel = false,
  className = ''
}) {
  const view = customerAvatarViewModel({ ...context, customer }, avatarConfig);
  const title = `${view.label} mood, score ${view.score}, ${view.gender}`;
  return (
    <span className={`d-inline-flex align-items-center gap-2 ${className}`.trim()} title={title}>
      <span
        className={`avatar rounded-circle bg-${view.tone}-lt text-${view.tone}`}
        style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size / 3)) }}
        aria-label={title}
      >
        {view.avatar?.data_url ? (
          <img
            src={view.avatar.data_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '999px' }}
          />
        ) : (
          view.initials
        )}
      </span>
      {showLabel && (
        <span className={`badge bg-${view.tone}-lt text-${view.tone}`}>
          {view.label} {view.score}
        </span>
      )}
    </span>
  );
}
