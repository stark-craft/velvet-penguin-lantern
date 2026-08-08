import React, { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { getViewerProfile, updateViewerProfile } from "../api.js";
import { useLanguage } from "../translation/LanguageProvider.jsx";
import useModalFocus from "./modals/useModalFocus.js";

const NAME_KEY = "news-viewer-name";
const EMAIL_KEY = "news-viewer-email";

const profileCopy = {
  en: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
    morningNote: "Your intelligence desk is ready.",
    afternoonNote: "Here is what is moving right now.",
    eveningNote: "Let’s close the day with the right signals.",
    explorer: "Intelligence explorer",
    eyebrow: "Make this desk yours",
    title: "What should TechScout call you?",
    description: "Your display name personalizes greetings and attributes review activity. It does not change the shared feed.",
    displayName: "Display name",
    namePlaceholder: "Anything you like",
    email: "Email",
    optional: "optional",
    emailPlaceholder: "you@company.com",
    networkTitle: "Current network identity",
    ipFallback: "Detected by the secure backend",
    networkNote: "Stored activity uses a protected IP hash; only you see this address here.",
    privacyTitle: "Private by design",
    privacyNote: "Your saved desk and personalization stay attached to your protected identity.",
    profileDetails: "Profile details",
    close: "Close profile",
    saving: "Saving…",
    enter: "Enter my intelligence desk",
    save: "Save profile",
    shortName: "Choose a name with at least two characters.",
    serviceError: "The profile service returned an unexpected response.",
    saveError: "Could not save your profile.",
  },
  ko: {
    morning: "좋은 아침입니다",
    afternoon: "좋은 오후입니다",
    evening: "좋은 저녁입니다",
    morningNote: "인텔리전스 데스크가 준비되었습니다.",
    afternoonNote: "지금 움직이는 주요 시그널입니다.",
    eveningNote: "오늘을 중요한 시그널과 함께 마무리하세요.",
    explorer: "인텔리전스 탐색자",
    eyebrow: "나만의 데스크 만들기",
    title: "TechScout이 어떻게 불러드릴까요?",
    description: "표시 이름은 인사말과 검토 활동을 개인화합니다. 공유 피드는 변경하지 않습니다.",
    displayName: "표시 이름",
    namePlaceholder: "원하는 이름을 입력하세요",
    email: "이메일",
    optional: "선택 사항",
    emailPlaceholder: "you@company.com",
    networkTitle: "현재 네트워크 식별 정보",
    ipFallback: "보안 백엔드에서 감지됨",
    networkNote: "저장 활동에는 보호된 IP 해시가 사용되며 이 주소는 본인만 볼 수 있습니다.",
    privacyTitle: "개인정보 보호 설계",
    privacyNote: "저장한 데스크와 개인화 정보는 보호된 식별 정보에 연결됩니다.",
    profileDetails: "프로필 정보",
    close: "프로필 닫기",
    saving: "저장 중…",
    enter: "인텔리전스 데스크 시작",
    save: "프로필 저장",
    shortName: "두 글자 이상의 이름을 선택하세요.",
    serviceError: "프로필 서비스에서 예상하지 못한 응답을 받았습니다.",
    saveError: "프로필을 저장할 수 없습니다.",
  },
};

export function greetingFor(date = new Date(), language = "en") {
  const ui = language === "ko" ? profileCopy.ko : profileCopy.en;
  const hour = date.getHours();
  if (hour < 12) return [ui.morning, ui.morningNote];
  if (hour < 17) return [ui.afternoon, ui.afternoonNote];
  return [ui.evening, ui.eveningNote];
}

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : parts[0]?.slice(0, 2) || "ME"
  ).toUpperCase();
}

export default function UserProfileModal({ open, firstVisit = false, viewer, onClose, onSaved }) {
  const { language } = useLanguage();
  const ui = language === "ko" ? profileCopy.ko : profileCopy.en;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [ip, setIp] = useState(ui.ipFallback);
  const [saving, setSaving] = useState(false);
  const dialogRef = useModalFocus(open, firstVisit ? undefined : onClose);

  useEffect(() => {
    if (!open) return;
    setName(viewer?.display_name || localStorage.getItem(NAME_KEY) || "");
    setEmail(viewer?.email || localStorage.getItem(EMAIL_KEY) || "");
    setIp(viewer?.ip || ui.ipFallback);
    setError("");
    getViewerProfile()
      .then((data) => {
        if (!data) return;
        if (!localStorage.getItem(NAME_KEY) && data.display_name) setName(data.display_name);
        if (!localStorage.getItem(EMAIL_KEY) && data.email) setEmail(data.email);
        if (data.ip) setIp(data.ip);
      })
      .catch(() => {});
  }, [open, viewer, ui.ipFallback]);

  if (!open) return null;

  const save = async (event) => {
    event?.preventDefault();
    const clean = name.trim();
    if (clean.length < 2) {
      setError(ui.shortName);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await updateViewerProfile({
        display_name: clean,
        email: email.trim(),
      });
      if (result?.status !== "success") {
        throw new Error(result?.detail || result?.message || ui.serviceError);
      }
      localStorage.setItem(NAME_KEY, clean);
      localStorage.setItem("initiator-name", clean);
      localStorage.setItem(EMAIL_KEY, email.trim());
      const savedProfile = {
        ...viewer,
        ...result,
        display_name: clean,
        email: email.trim(),
        ip: result?.ip || ip,
      };
      onSaved(savedProfile);
      onClose();
    } catch (saveError) {
      setError(saveError.message || ui.saveError);
    } finally {
      setSaving(false);
    }
  };

  const [greeting, note] = greetingFor(new Date(), language);
  const displayName = name.trim() || ui.explorer;

  return (
    <div
      className="modal-overlay profile-overlay premium-profile-overlay"
      data-no-translate
      onClick={firstVisit ? undefined : onClose}
    >
      <div
        aria-describedby="viewer-profile-description"
        aria-labelledby="viewer-profile-title"
        aria-modal="true"
        className="profile-dialog premium-profile-dialog natural-profile-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="natural-profile-accent" aria-hidden="true" />
        <header className="natural-profile-header">
          <div className="natural-profile-brand" aria-hidden="true">
            <Icon name="sparkle" size={18} />
          </div>
          <div className="natural-profile-heading">
            <span className="eyebrow">{ui.eyebrow}</span>
            <h2 id="viewer-profile-title">{ui.title}</h2>
            <p id="viewer-profile-description">{ui.description}</p>
          </div>
          {!firstVisit && (
            <button
              aria-label={ui.close}
              className="premium-profile-close natural-profile-close"
              onClick={onClose}
              title={ui.close}
              type="button"
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </header>

        <div className="natural-profile-welcome" aria-label={`${greeting}, ${displayName}`}>
          <span className="natural-profile-avatar" aria-hidden="true">
            {initialsFor(displayName)}
          </span>
          <div>
            <small>{greeting}</small>
            <strong>{displayName}</strong>
            <p>{note}</p>
          </div>
          <span className="natural-profile-ready">
            <span aria-hidden="true" />
            {ui.privacyTitle}
          </span>
        </div>

        <form className="profile-dialog-content premium-profile-content natural-profile-form" onSubmit={save}>
          <div className="profile-dialog-head premium-profile-head natural-profile-form-heading">
            <div>
              <span>{ui.profileDetails}</span>
              <small>{ui.privacyNote}</small>
            </div>
          </div>

          <div className="premium-profile-fields">
            <label>
              <span>{ui.displayName}</span>
              <div className="premium-profile-input">
                <Icon name="sparkle" size={16} />
                <input
                  autoComplete="nickname"
                  autoFocus
                  maxLength={80}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                  placeholder={ui.namePlaceholder}
                  value={name}
                />
              </div>
            </label>
            <label>
              <span>{ui.email} <em>{ui.optional}</em></span>
              <div className="premium-profile-input">
                <Icon name="note" size={16} />
                <input
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={ui.emailPlaceholder}
                  type="email"
                  value={email}
                />
              </div>
            </label>
          </div>

          <div className="profile-ip premium-profile-network">
            <span className="premium-profile-network-icon" aria-hidden="true">
              <Icon name="globe" size={18} />
            </span>
            <div>
              <span>{ui.networkTitle}</span>
              <strong>{ip}</strong>
              <small>{ui.networkNote}</small>
            </div>
            <span className="premium-network-live" aria-hidden="true" />
          </div>

          {error && (
            <div className="profile-error premium-profile-error" role="alert">
              <Icon name="warning" size={16} />
              {error}
            </div>
          )}

          <button className="profile-save premium-profile-save" disabled={saving} type="submit">
            <span>{saving ? ui.saving : firstVisit ? ui.enter : ui.save}</span>
            <Icon name="chevR" size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}
