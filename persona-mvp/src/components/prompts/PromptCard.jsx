import React, { useEffect, useRef, useCallback } from 'react';

const TRIGGER_CONFIG = {
  INTERACTION_START: {
    icon: '👤',
    question: 'Log this conversation?',
    primary: 'Log',
    dismiss: 'Skip',
    defaultAction: 'primary',
  },
  INTERACTION_END: {
    icon: '💾',
    question: 'Save transcript and summary?',
    primary: 'Save',
    dismiss: 'Discard',
    defaultAction: 'primary',
  },
  NEW_PERSON: {
    icon: '🙋',
    question: 'New person detected!',
    primary: 'Save as',
    dismiss: 'Skip',
    defaultAction: 'primary',
  },
  MEAL_DETECTED: {
    icon: '🍽',
    question: 'Looks like a meal. Log it?',
    primary: 'Log',
    dismiss: 'Skip',
    defaultAction: 'primary',
  },
  LOW_CONFIDENCE_MEAL: {
    icon: '🤔',
    question: "Can't identify meal clearly. Log anyway?",
    primary: 'Log',
    dismiss: 'Skip',
    defaultAction: 'primary',
  },
  SCREEN_BREAK: {
    icon: '🖥',
    question: '90+ min at screen. Take a break?',
    primary: 'Remind me',
    dismiss: 'Dismiss',
    defaultAction: 'dismiss',
  },
};

const COUNTDOWN_KEYFRAMES = `
@keyframes countdownShrink {
  from { width: 100%; }
  to { width: 0%; }
}
`;

export default function PromptCard({
  trigger,
  contextData = {},
  onPrimary,
  onDismiss,
  timeoutSeconds = 15,
}) {
  const timeoutRef = useRef(null);
  const config = TRIGGER_CONFIG[trigger];

  const handlePrimary = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onPrimary();
  }, [onPrimary]);

  const handleDismiss = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (!config) return;
    const defaultFn = config.defaultAction === 'dismiss' ? onDismiss : onPrimary;
    timeoutRef.current = setTimeout(defaultFn, timeoutSeconds * 1000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [config, timeoutSeconds, onPrimary, onDismiss]);

  if (!config) return null;

  const primaryLabel =
    trigger === 'NEW_PERSON' && contextData.personName
      ? `Save as ${contextData.personName}`
      : config.primary;

  const subtext =
    trigger === 'MEAL_DETECTED' && contextData.calories != null
      ? `~${contextData.calories} calories`
      : trigger === 'SCREEN_BREAK' && contextData.screenMinutes != null
        ? `You've been at a screen for ${contextData.screenMinutes} minutes`
        : null;

  return (
    <>
      <style>{COUNTDOWN_KEYFRAMES}</style>
      <div style={styles.overlay}>
        <div style={styles.card}>
          {/* Icon */}
          <div style={styles.icon}>{config.icon}</div>

          {/* Snapshot image */}
          {contextData.snapshotBase64 && (
            <img
              src={`data:image/jpeg;base64,${contextData.snapshotBase64}`}
              alt="snapshot"
              style={styles.snapshot}
            />
          )}

          {/* Question */}
          <div style={styles.question}>{config.question}</div>

          {/* Subtext */}
          {subtext && <div style={styles.subtext}>{subtext}</div>}

          {/* Buttons */}
          <div style={styles.buttonGroup}>
            <button style={styles.primaryButton} onClick={handlePrimary}>
              {primaryLabel}
            </button>
            <button style={styles.dismissButton} onClick={handleDismiss}>
              {config.dismiss}
            </button>
          </div>

          {/* Countdown bar */}
          <div style={styles.countdownTrack}>
            <div
              style={{
                ...styles.countdownBar,
                animationDuration: `${timeoutSeconds}s`,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(25, 28, 24, 0.45)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  card: {
    position: 'relative',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    maxWidth: 360,
    width: '90%',
    padding: 32,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    overflow: 'hidden',
    boxShadow: '0 24px 60px rgba(85,98,77,0.16)',
  },
  icon: {
    fontSize: 48,
    lineHeight: 1,
  },
  snapshot: {
    width: 64,
    height: 64,
    borderRadius: 12,
    objectFit: 'cover',
  },
  question: {
    color: '#191c18',
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'Manrope, sans-serif',
    textAlign: 'center',
    lineHeight: 1.3,
  },
  subtext: {
    color: '#444841',
    fontSize: 14,
    textAlign: 'center',
  },
  buttonGroup: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    width: '100%',
    height: 48,
    borderRadius: 9999,
    border: 'none',
    background: '#55624d',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  dismissButton: {
    width: '100%',
    height: 48,
    borderRadius: 9999,
    border: 'none',
    backgroundColor: '#ecefe8',
    color: '#444841',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  countdownTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'transparent',
  },
  countdownBar: {
    height: '100%',
    backgroundColor: '#55624d',
    animationName: 'countdownShrink',
    animationTimingFunction: 'linear',
    animationFillMode: 'forwards',
  },
};
