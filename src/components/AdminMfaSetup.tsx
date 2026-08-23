import { useState } from 'react';
import { ShieldCheck, Loader2, KeyRound, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function AdminMfaSetup({ onVerified }: { onVerified: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const enroll = async () => {
    setLoading(true);
    setError('');
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Hajj & Umrah ERP Admin',
    });
    setLoading(false);
    if (enrollError || !data) {
      setError(enrollError?.message || 'Unable to start MFA enrollment.');
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
  };

  const verify = async () => {
    if (!factorId || !/^\d{6}$/.test(code)) return;
    setLoading(true);
    setError('');
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setLoading(false);
      setError(challengeError?.message || 'Unable to create MFA challenge.');
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    setLoading(false);
    if (verifyError) {
      setError(verifyError.message || 'Invalid authentication code.');
      return;
    }
    onVerified();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-12 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400"><ShieldCheck className="h-6 w-6" /></div>
          <div>
            <h1 className="text-xl font-semibold">تفعيل المصادقة الثنائية</h1>
            <p className="text-sm text-zinc-400">حسابات الإدارة يجب أن تستخدم TOTP في وضع الإنتاج.</p>
          </div>
        </div>

        {!factorId ? (
          <button onClick={enroll} disabled={loading} className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
            إنشاء عامل MFA
          </button>
        ) : (
          <div className="mt-8 space-y-5">
            {qr && <img src={qr} alt="MFA QR Code" className="mx-auto h-52 w-52 rounded-xl bg-white p-3" />}
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs text-zinc-400">مفتاح الإعداد اليدوي</p>
              <p className="mt-2 break-all font-mono text-sm text-zinc-200">{secret}</p>
            </div>
            <div>
              <label className="mb-2 block text-sm text-zinc-300">رمز المصادقة المكون من 6 أرقام</label>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-center font-mono text-lg tracking-[0.35em] outline-none focus:border-emerald-500" />
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button onClick={verify} disabled={loading || code.length !== 6} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              تأكيد وتفعيل MFA
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
