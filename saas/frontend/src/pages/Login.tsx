import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle, Loader2, Rocket, ShieldCheck } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8787' : 'https://sbir-api.thinkwithblack.com');
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const TURNSTILE_SUCCESS_CALLBACK = '__sbirTurnstileSuccess';
const TURNSTILE_ERROR_CALLBACK = '__sbirTurnstileError';
const TURNSTILE_EXPIRED_CALLBACK = '__sbirTurnstileExpired';

const ERROR_MESSAGES: Record<string, string> = {
    TURNSTILE_NOT_CONFIGURED: 'Cloudflare Turnstile 尚未設定完成。',
    MISSING_TURNSTILE_TOKEN: '請先完成人機驗證後再登入。',
    TURNSTILE_FAILED: 'Cloudflare 人機驗證未通過，請稍後再試。',
    TURNSTILE_VERIFY_FAILED: 'Cloudflare 驗證服務暫時無法使用，請稍後再試。',
    TURNSTILE_HOSTNAME_MISMATCH: 'Turnstile 網域設定不一致，已拒絕登入。',
    INVALID_REQUEST_BODY: '登入請求格式錯誤。',
};

export default function Login() {
    const { user, isLoading } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const formRef = useRef<HTMLFormElement | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isScriptReady, setIsScriptReady] = useState(false);
    const [scriptError, setScriptError] = useState<string | null>(null);
    const [turnstileToken, setTurnstileToken] = useState('');
    const [turnstileStatusMessage, setTurnstileStatusMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!isLoading && user) {
            navigate('/app', { replace: true });
        }
    }, [user, isLoading, navigate]);

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) {
            return;
        }
        const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
        const onLoad = () => {
            setIsScriptReady(true);
            setScriptError(null);
        };
        const onError = () => {
            setScriptError('Cloudflare Turnstile 載入失敗，請稍後再試。');
            setIsScriptReady(false);
        };

        if (existing) {
            if ((window as Window & { turnstile?: unknown }).turnstile) {
                onLoad();
            }
            existing.addEventListener('load', onLoad);
            existing.addEventListener('error', onError);
            return () => {
                existing.removeEventListener('load', onLoad);
                existing.removeEventListener('error', onError);
            };
        }

        const script = document.createElement('script');
        script.id = TURNSTILE_SCRIPT_ID;
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener('load', onLoad);
        script.addEventListener('error', onError);
        document.head.appendChild(script);

        return () => {
            script.removeEventListener('load', onLoad);
            script.removeEventListener('error', onError);
        };
    }, []);

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY) {
            return;
        }

        type TurnstileCallbackWindow = Window & {
            [TURNSTILE_SUCCESS_CALLBACK]?: (token: string) => void;
            [TURNSTILE_ERROR_CALLBACK]?: (error?: string) => void;
            [TURNSTILE_EXPIRED_CALLBACK]?: () => void;
        };

        const callbackWindow = window as TurnstileCallbackWindow;
        callbackWindow[TURNSTILE_SUCCESS_CALLBACK] = (token: string) => {
            setTurnstileToken(token);
            setTurnstileStatusMessage(null);
            setScriptError(null);
        };
        callbackWindow[TURNSTILE_ERROR_CALLBACK] = () => {
            setTurnstileToken('');
            setTurnstileStatusMessage('Cloudflare 人機驗證載入失敗，請稍後再試。');
            setIsSubmitting(false);
        };
        callbackWindow[TURNSTILE_EXPIRED_CALLBACK] = () => {
            setTurnstileToken('');
            setTurnstileStatusMessage('Cloudflare 驗證已過期，請稍候重新完成驗證。');
            setIsSubmitting(false);
        };

        return () => {
            delete callbackWindow[TURNSTILE_SUCCESS_CALLBACK];
            delete callbackWindow[TURNSTILE_ERROR_CALLBACK];
            delete callbackWindow[TURNSTILE_EXPIRED_CALLBACK];
        };
    }, []);

    const errorMessage = useMemo(() => {
        const code = searchParams.get('error');
        if (!code) {
            return turnstileStatusMessage || scriptError;
        }
        return ERROR_MESSAGES[code] || '登入過程發生錯誤，請稍後再試。';
    }, [searchParams, scriptError, turnstileStatusMessage]);

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        const form = formRef.current;
        const tokenField = form?.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
        const token = tokenField?.value?.trim() || turnstileToken.trim();

        if (!token) {
            event.preventDefault();
            setIsSubmitting(false);
            setTurnstileStatusMessage('請先完成人機驗證再登入。');
            return;
        }

        setTurnstileToken(token);
        setTurnstileStatusMessage(null);
        setIsSubmitting(true);
    };

    if (isLoading) return null;

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <div className="flex-1 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="flex justify-center text-primary-600">
                        <Rocket className="w-12 h-12" />
                    </div>
                    <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-900">
                        SBIR Cloud
                    </h2>
                    <p className="mt-2 text-center text-sm text-slate-600">
                        SaaS 版本 - 您的專屬計畫書產生器
                    </p>
                </div>

                <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
                    <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-200">
                        <form ref={formRef} action={`${API_BASE}/auth/google/precheck`} method="POST" onSubmit={handleSubmit} className="space-y-6">
                            {!TURNSTILE_SITE_KEY ? (
                                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>尚未設定 Turnstile site key，登入已停用。</span>
                                </div>
                            ) : null}

                            {TURNSTILE_SITE_KEY ? (
                                <div className="flex justify-center min-h-[70px] items-center">
                                    <div
                                        className="cf-turnstile"
                                        data-sitekey={TURNSTILE_SITE_KEY}
                                        data-theme="light"
                                        data-size="flexible"
                                        data-language="zh-tw"
                                        data-action="google_login"
                                        data-appearance="always"
                                        data-callback={TURNSTILE_SUCCESS_CALLBACK}
                                        data-error-callback={TURNSTILE_ERROR_CALLBACK}
                                        data-expired-callback={TURNSTILE_EXPIRED_CALLBACK}
                                    />
                                </div>
                            ) : null}

                            {TURNSTILE_SITE_KEY && !isScriptReady ? (
                                <div className="flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    正在載入 Cloudflare 驗證元件...
                                </div>
                            ) : null}

                            {errorMessage ? (
                                <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <span>{errorMessage}</span>
                                </div>
                            ) : null}

                            <button
                                type="submit"
                                disabled={isSubmitting || !TURNSTILE_SITE_KEY || !isScriptReady || !turnstileToken}
                                className="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
                            >
                                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                使用 Google 帳號登入
                            </button>
                        </form>

                        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
                            <ShieldCheck className="w-4 h-4" />
                            <span>安全、快速的 SSO 驗證</span>
                        </div>
                    </div>
                </div>
            </div>
            <footer className="px-6 py-6 text-center text-sm text-slate-500">
                由 © 2025 煜言顧問有限公司(TW) 燈言顧問株式会社(JP) 設計
            </footer>
        </div>
    );
}
