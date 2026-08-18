"use client";

import { useEffect, useState } from "react";
import { X, Mail, Send, CheckCircle2, MessageSquarePlus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import MatchaMark from "./MatchaMark";

/**
 * Both "Suggest an update" and "Suggest a cafe" CTAs used to be either dead buttons
 * or a detour through account sign-up for a feature that doesn't exist on the other
 * side of it. Neither the frontend nor backend has anywhere to durably store a
 * submission yet (no `suggestions` table, no email service configured), so this opens
 * the visitor's own email client with the message pre-filled — it is the only capture
 * path that is fully real today rather than another façade. Swap the `TO_EMAIL`
 * constant, or replace handleSubmit with a POST once a real inbox/table exists.
 */
const TO_EMAIL = "eishi.stab@gmail.com";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fills the subject/body with the cafe this suggestion is about. Omit for a
   *  general "know a cafe we missed?" submission. */
  context?: { name: string; suburb?: string; city?: string };
}

const SPRING = { type: "spring" as const, stiffness: 380, damping: 32 };
const EASE   = [0.25, 0.46, 0.45, 0.94] as const;

export default function SuggestModal({ isOpen, onClose, context }: Props) {
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [sent, setSent]       = useState(false);

  // Fresh form each time the modal opens
  useEffect(() => {
    if (isOpen) { setMessage(""); setContact(""); setSent(false); }
  }, [isOpen]);

  const isUpdate = Boolean(context);
  const subject = isUpdate
    ? `Update for ${context!.name}${context!.suburb ? ` (${context!.suburb})` : ""} — MatchaScope`
    : "New cafe suggestion — MatchaScope";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = [
      isUpdate ? `Regarding: ${context!.name}${context!.city ? `, ${context!.city}` : ""}` : null,
      "",
      message.trim(),
      "",
      contact.trim() ? `Reply to: ${contact.trim()}` : null,
    ].filter((l) => l !== null).join("\n");

    window.location.href = `mailto:${TO_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="suggest-backdrop"
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className="absolute inset-0 -z-10"
            style={{ background: "rgba(5,14,7,0.6)" }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.88, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={SPRING}
            className="relative w-full max-w-md rounded-3xl overflow-hidden"
            style={{ background: "#fff", boxShadow: "0 32px 96px rgba(0,0,0,0.22), 0 8px 32px rgba(0,0,0,0.12)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1.5 w-full bg-gradient-to-r from-matcha-700 via-matcha-500 to-matcha-300" />

            <div className="p-8">
              <motion.button
                onClick={onClose}
                className="absolute top-6 right-6 p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.92 }}
                transition={SPRING}
              >
                <X size={18} />
              </motion.button>

              <motion.div className="flex items-center gap-2 mb-7"
                initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08, duration: 0.4, ease: EASE }}
              >
                <MatchaMark size={32} />
                <span className="font-semibold text-matcha-900 text-[16px] tracking-wide">MatchaScope</span>
              </motion.div>

              <AnimatePresence mode="wait">
                {sent ? (
                  <motion.div
                    key="sent"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="text-center py-4"
                  >
                    <motion.div
                      className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                      style={{ background: "#e0f0d8" }}
                      initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={SPRING}
                    >
                      <CheckCircle2 size={26} className="text-matcha-700" />
                    </motion.div>
                    <h2 className="text-xl font-display font-semibold text-gray-900 mb-1.5">
                      Your email app should be open
                    </h2>
                    <p className="text-[16px] text-gray-500 leading-relaxed mb-6">
                      We pre-filled the message — just hit send from there. If nothing
                      opened, email us directly at{" "}
                      <a href={`mailto:${TO_EMAIL}`} className="text-matcha-700 font-medium hover:underline">
                        {TO_EMAIL}
                      </a>.
                    </p>
                    <motion.button
                      onClick={onClose}
                      className="w-full py-3 rounded-xl font-semibold text-[16px] text-white"
                      style={{ background: "linear-gradient(135deg, #2e6027 0%, #4d9740 100%)" }}
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                    >
                      Done
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <MessageSquarePlus size={18} className="text-matcha-700" />
                      <h2 className="text-2xl font-display font-semibold text-gray-900">
                        {isUpdate ? "Suggest an update" : "Know a cafe we missed?"}
                      </h2>
                    </div>
                    <p className="text-[16px] text-gray-500 mb-6">
                      {isUpdate
                        ? `Tell us what's wrong or out of date on ${context!.name}'s listing.`
                        : "Tell us the name and where it is — if the sourcing evidence checks out, we'll add and grade it."}
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                      {isUpdate && (
                        <div className="px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 text-[16px] text-gray-600">
                          Regarding <span className="font-semibold text-gray-800">{context!.name}</span>
                          {context!.suburb ? `, ${context!.suburb}` : ""}
                        </div>
                      )}

                      <div>
                        <label className="block text-[16px] font-medium text-gray-700 mb-1.5">
                          {isUpdate ? "What should we check?" : "Cafe name & location, plus any sourcing evidence"}
                        </label>
                        <motion.textarea
                          required
                          rows={4}
                          placeholder={isUpdate
                            ? "e.g. their menu now names Uji, Kyoto as the origin…"
                            : "e.g. Green Leaf Cafe, 12 Crown St Surry Hills — their Instagram bio names Nishio, Aichi…"}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 text-[16px] outline-none placeholder:text-gray-300 transition-all resize-none"
                          whileFocus={{ boxShadow: "0 0 0 3px rgba(78,151,64,0.15), 0 0 0 1px #4d9740" } as any}
                        />
                      </div>

                      <div>
                        <label className="block text-[16px] font-medium text-gray-700 mb-1.5">
                          Your email <span className="text-gray-400 font-normal">(optional — so we can follow up)</span>
                        </label>
                        <div className="relative">
                          <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          <motion.input
                            type="email"
                            placeholder="you@example.com"
                            value={contact}
                            onChange={(e) => setContact(e.target.value)}
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 text-[16px] outline-none placeholder:text-gray-300 transition-all"
                            whileFocus={{ boxShadow: "0 0 0 3px rgba(78,151,64,0.15), 0 0 0 1px #4d9740" } as any}
                          />
                        </div>
                      </div>

                      <motion.button
                        type="submit"
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[16px] text-white mt-2"
                        style={{
                          background: "linear-gradient(135deg, #2e6027 0%, #4d9740 100%)",
                          boxShadow: "0 4px 16px rgba(46,96,39,0.35)",
                        }}
                        whileHover={{ scale: 1.02, boxShadow: "0 6px 24px rgba(46,96,39,0.45)" } as any}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Send size={15} />
                        {isUpdate ? "Send suggestion" : "Suggest this cafe"}
                      </motion.button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
