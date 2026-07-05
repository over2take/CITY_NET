import React, { useState, useEffect, useRef } from 'react';

export type LoginView = 'login' | 'register' | 'forgot' | 'forgot_awaiting' | 'reset' | 'pending';

export interface SecureLoginProps {
  secureModeEnabled: boolean;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onSimpleLogin: (name: string) => void;
  onSecureLogin: (username: string, playerToken: string) => void;
  onAdminLogin: (username: string, adminToken: string) => void;
  onPendingsFetched: (rows: { username: string; created_at: string }[]) => void;
  StatusLogDisplay: React.ComponentType;
}

export function SecureLogin({
  secureModeEnabled,
  audioEnabled,
  onToggleAudio,
  onSimpleLogin,
  onSecureLogin,
  onAdminLogin,
  onPendingsFetched,
  StatusLogDisplay,
}: SecureLoginProps) {
  const [loginView, setLoginView] = useState<LoginView>('login');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', password: '', confirmPassword: '', security_question: '', security_answer: '', customQuestion: '' });
  const [forgotForm, setForgotForm] = useState({ username: '', security_answer: '' });
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [questionLoading, setQuestionLoading] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetUsername, setResetUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [tempUserName, setTempUserName] = useState('');
  const [loginError, setLoginError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingUsername = useRef<string>('');

  // Poll registration status while waiting for admin approval
  useEffect(() => {
    if (loginView !== 'pending' || !pendingUsername.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/player/players/status/${encodeURIComponent(pendingUsername.current)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'approved') {
          clearInterval(pollRef.current!);
          setLoginView('login');
          setLoginError('');
        } else if (data.status === 'denied' || data.status === undefined) {
          clearInterval(pollRef.current!);
          setLoginError('Your registration was denied. Please contact your GM.');
          setLoginView('login');
        }
      } catch { /* network hiccup — try again next tick */ }
    }, 3000);
    return () => clearInterval(pollRef.current!);
  }, [loginView]);

  // Poll for admin approval when in awaiting state
  useEffect(() => {
    if (loginView !== 'forgot_awaiting' || !requestId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/player/reset-status/${requestId}`);
        if (!res.ok) { clearInterval(pollRef.current!); setLoginError('Reset request expired'); setLoginView('login'); return; }
        const data = await res.json();
        if (data.status === 'approved') {
          clearInterval(pollRef.current!);
          setResetToken(data.resetToken);
          setLoginView('reset');
        } else if (data.status === 'denied') {
          clearInterval(pollRef.current!);
          setLoginError('Reset request was denied');
          setLoginView('login');
        }
      } catch { /* network hiccup — try again next tick */ }
    }, 3000);
    return () => clearInterval(pollRef.current!);
  }, [loginView, requestId]);

  const fetchSecurityQuestion = async () => {
    const username = forgotForm.username.trim();
    if (!username) return;
    setQuestionLoading(true);
    setSecurityQuestion('');
    setLoginError('');
    try {
      const res = await fetch(`/api/player/question?username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (!res.ok) { setLoginError(data.error || 'Account not found'); }
      else { setSecurityQuestion(data.question); }
    } catch { setLoginError('Could not reach server'); }
    setQuestionLoading(false);
  };

  const handleSecureLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const adminRes = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginForm) });
    const adminData = await adminRes.json();
    if (adminRes.ok && adminData.token) {
      onAdminLogin(loginForm.username, adminData.token);
      fetch('/api/player/admin/players/pending', { headers: { Authorization: `Bearer ${adminData.token}` } })
        .then(r => r.json()).then(rows => onPendingsFetched(rows)).catch(() => {});
      return;
    }
    const playerRes = await fetch('/api/player/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginForm.username, password: loginForm.password }) });
    if (playerRes.ok) {
      const data = await playerRes.json();
      if (data.tempPassword) { setResetToken(data.playerToken); setResetUsername(loginForm.username); setLoginView('reset'); return; }
      onSecureLogin(loginForm.username, data.playerToken);
      return;
    }
    setLoginError('Invalid credentials');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (registerForm.password !== registerForm.confirmPassword) return setLoginError('Passwords do not match');
    if (!registerForm.security_question) return setLoginError('Please select a security question');
    const finalQuestion = registerForm.security_question === 'custom' ? registerForm.customQuestion.trim() : registerForm.security_question;
    if (!finalQuestion) return setLoginError('Please enter your custom security question');
    const { customQuestion: _cq, confirmPassword: _cp, ...rest } = registerForm;
    const res = await fetch('/api/player/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rest, security_question: finalQuestion }) });
    const data = await res.json();
    if (!res.ok) return setLoginError(data.error || 'Registration failed');
    pendingUsername.current = registerForm.username.trim();
    setLoginView('pending');
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!securityQuestion) return setLoginError('Please look up your security question first');
    const res = await fetch('/api/player/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forgotForm) });
    const data = await res.json();
    if (!res.ok) return setLoginError(data.error || 'Failed');
    setResetUsername(forgotForm.username);
    setRequestId(data.requestId);
    setForgotForm({ username: '', security_answer: '' });
    setSecurityQuestion('');
    setLoginView('forgot_awaiting');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (newPassword !== confirmNewPassword) return setLoginError('Passwords do not match');
    const res = await fetch('/api/player/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, newPassword }) });
    const data = await res.json();
    if (!res.ok) return setLoginError(data.error || 'Failed');
    setLoginView('login');
    setLoginError('Password updated — please log in');
  };

  return (
    <div className="modal-overlay">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <div className="panel login-panel" style={{ textAlign: 'center', minWidth: '350px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
            <button className={`admin-toggle ${!audioEnabled ? 'muted' : ''}`} onClick={onToggleAudio} style={{ padding: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {audioEnabled ? (
                <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                  <path fill="currentColor" fillRule="evenodd" d="m403.966 426.944l-33.285-26.63c74.193-81.075 74.193-205.015-.001-286.09l33.285-26.628c86.612 96.712 86.61 242.635.001 339.348M319.58 155.105l-33.324 26.659c39.795 42.568 39.794 108.444.001 151.012l33.324 26.658c52.205-58.22 52.205-146.109-.001-204.329m-85.163-69.772l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
                  <path fill="currentColor" fillRule="evenodd" d="m403.375 257.27l59.584 59.584l-30.167 30.166l-59.583-59.583l-59.584 59.583l-30.166-30.166l59.583-59.584l-59.583-59.583l30.166-30.166l59.584 59.583l59.583-59.583l30.167 30.166zM234.417 85.333l-110.854 87.23H42.667v170.666h81.02l110.73 85.458z" />
                </svg>
              )}
            </button>
          </div>

          <h1 style={{ fontSize: '3rem', margin: '0', textShadow: 'var(--glow)' }}>CITY_NET</h1>
          <div style={{ fontSize: '0.65rem', opacity: 0.5, letterSpacing: '4px', marginTop: '35px', marginBottom: '15px' }}>NAV_OS_v{__APP_VERSION__}</div>

          {loginError && (
            <div style={{ fontSize: '0.7rem', color: loginError.includes('updated') ? 'var(--green)' : '#ff3333', marginBottom: '10px', letterSpacing: '1px' }}>
              {loginError}
            </div>
          )}

          {/* ── Secure Mode OFF ── */}
          {!secureModeEnabled && (
            <div>
              <input value={tempUserName} onChange={e => setTempUserName(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSimpleLogin(tempUserName)} placeholder="OPERATOR_ID" style={{ fontSize: '1.2rem', textAlign: 'center' }} />
              <button className="upload-btn" onClick={() => onSimpleLogin(tempUserName)} style={{ fontSize: '1.2rem', padding: '10px' }}>LOGIN</button>
            </div>
          )}

          {/* ── Secure Mode ON — login ── */}
          {secureModeEnabled && loginView === 'login' && (
            <form onSubmit={handleSecureLogin} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              <input value={loginForm.username} onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))} placeholder="OPERATOR_ID" style={{ textAlign: 'center', width: '100%' }} />
              <input type="password" value={loginForm.password} onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))} placeholder="ACCESS_CODE" style={{ textAlign: 'center', width: '100%' }} />
              <button type="submit" className="upload-btn" style={{ fontSize: '1.1rem', padding: '10px' }}>LOGIN</button>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <button type="button" className="utility-btn" style={{ fontSize: '0.65rem' }} onClick={() => { setLoginView('register'); setLoginError(''); }}>REGISTER</button>
                <button type="button" className="utility-btn" style={{ fontSize: '0.65rem' }} onClick={() => { setForgotForm({ username: '', security_answer: '' }); setSecurityQuestion(''); setLoginView('forgot'); setLoginError(''); }}>FORGOT_PASSWORD</button>
              </div>
            </form>
          )}

          {/* ── Secure Mode ON — register ── */}
          {secureModeEnabled && loginView === 'register' && (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              <input value={registerForm.username} onChange={e => setRegisterForm(f => ({ ...f, username: e.target.value }))} placeholder="OPERATOR_ID" style={{ textAlign: 'center', width: '100%' }} />
              <input type="password" value={registerForm.password} onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))} placeholder="ACCESS_CODE" style={{ textAlign: 'center', width: '100%' }} />
              <input type="password" value={registerForm.confirmPassword} onChange={e => setRegisterForm(f => ({ ...f, confirmPassword: e.target.value }))} placeholder="CONFIRM_ACCESS_CODE" style={{ textAlign: 'center', width: '100%' }} />
              <select value={registerForm.security_question} onChange={e => setRegisterForm(f => ({ ...f, security_question: e.target.value }))} style={{ width: '100%' }}>
                <option value="">SELECT_SECURITY_QUESTION</option>
                <option>What was the color of your first car?</option>
                <option>What is your favorite movie?</option>
                <option>What was the name of your first pet?</option>
                <option>What city were you born in?</option>
                <option>What is your mother&apos;s maiden name?</option>
                <option value="custom">Other (write your own)</option>
              </select>
              {registerForm.security_question === 'custom' && (
                <input value={registerForm.customQuestion} onChange={e => setRegisterForm(f => ({ ...f, customQuestion: e.target.value }))} placeholder="CUSTOM_QUESTION" style={{ textAlign: 'center', width: '100%' }} />
              )}
              <input value={registerForm.security_answer} onChange={e => setRegisterForm(f => ({ ...f, security_answer: e.target.value }))} placeholder="SECURITY_ANSWER" style={{ textAlign: 'center', width: '100%' }} autoComplete="new-password" />
              <button type="submit" className="upload-btn">CREATE_ACCOUNT</button>
              <button type="button" className="utility-btn" style={{ fontSize: '0.65rem' }} onClick={() => { setLoginView('login'); setLoginError(''); }}>BACK_TO_LOGIN</button>
            </form>
          )}

          {/* ── Awaiting admin approval ── */}
          {secureModeEnabled && loginView === 'pending' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
              <div style={{ fontSize: '0.75rem', letterSpacing: '2px', color: 'var(--green)' }}>REGISTRATION_SUBMITTED</div>
              <div style={{ fontSize: '0.65rem', opacity: 0.6, textAlign: 'center', lineHeight: '1.6' }}>Your account is awaiting admin approval.<br />You will be able to log in once approved.</div>
              <button className="utility-btn" style={{ fontSize: '0.65rem' }} onClick={() => { setLoginView('login'); setLoginError(''); }}>BACK_TO_LOGIN</button>
            </div>
          )}

          {/* ── Secure Mode ON — forgot password ── */}
          {secureModeEnabled && loginView === 'forgot' && (
            <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              <input value={forgotForm.username} onChange={e => { setForgotForm(f => ({ ...f, username: e.target.value })); setSecurityQuestion(''); }} placeholder="OPERATOR_ID" style={{ textAlign: 'center', width: '100%' }} autoComplete="off" />
              <button type="button" className="utility-btn" style={{ fontSize: '0.65rem', alignSelf: 'flex-end', padding: '4px 14px' }} onClick={fetchSecurityQuestion} disabled={questionLoading || !forgotForm.username.trim()}>
                {questionLoading ? 'SEARCHING...' : 'LOOKUP_QUESTION'}
              </button>
              {securityQuestion && (
                <>
                  <div style={{ fontSize: '0.65rem', opacity: 0.7, textAlign: 'center', letterSpacing: '1px', padding: '4px 0' }}>{securityQuestion}</div>
                  <input value={forgotForm.security_answer} onChange={e => setForgotForm(f => ({ ...f, security_answer: e.target.value }))} placeholder="SECURITY_ANSWER" style={{ textAlign: 'center', width: '100%' }} autoComplete="new-password" />
                  <button type="submit" className="upload-btn">VERIFY</button>
                </>
              )}
              <button type="button" className="utility-btn" style={{ fontSize: '0.65rem' }} onClick={() => { setForgotForm({ username: '', security_answer: '' }); setSecurityQuestion(''); setLoginView('login'); setLoginError(''); }}>BACK_TO_LOGIN</button>
            </form>
          )}

          {/* ── Awaiting admin approval for reset ── */}
          {secureModeEnabled && loginView === 'forgot_awaiting' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
              <div style={{ fontSize: '0.75rem', letterSpacing: '2px', color: '#ffaa00' }}>RESET_REQUEST_SUBMITTED</div>
              <div style={{ fontSize: '0.65rem', opacity: 0.6, textAlign: 'center', lineHeight: '1.6' }}>
                Waiting for admin approval.<br />Your GM will need to approve this request.
              </div>
              <div style={{ fontSize: '0.6rem', opacity: 0.4, letterSpacing: '2px' }}>[ AWAITING... ]</div>
              <button className="utility-btn" style={{ fontSize: '0.65rem' }} onClick={() => { clearInterval(pollRef.current!); setLoginView('login'); setLoginError(''); }}>CANCEL</button>
            </div>
          )}

          {/* ── Secure Mode ON — reset password ── */}
          {secureModeEnabled && loginView === 'reset' && (
            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
              {resetUsername && <div style={{ fontSize: '0.7rem', opacity: 0.5, letterSpacing: '2px' }}>{resetUsername}</div>}
              <div style={{ fontSize: '0.7rem', opacity: 0.7 }}>SET_NEW_ACCESS_CODE</div>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="NEW_ACCESS_CODE" style={{ textAlign: 'center', width: '100%' }} />
              <input type="password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} placeholder="CONFIRM_ACCESS_CODE" style={{ textAlign: 'center', width: '100%' }} />
              <button type="submit" className="upload-btn">CONFIRM</button>
            </form>
          )}
        </div>
        <StatusLogDisplay />
      </div>
    </div>
  );
}
