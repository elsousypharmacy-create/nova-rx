// Classify the Aumet spa-login response into fixed booleans. Never returns body text
// (server messages can contain account data).
function classifyLogin(status, body) {
  const text = String(body || '');
  const otherSession = /another device|other device|already logged|logout.others|log.out.other|جهاز آخر|جهاز اخر/i.test(text);
  const verificationRequired = /captcha|verification.code|one.time.password|two.factor|رمز التحقق/i.test(text);
  const rateLimited = status === 429 || /too many|rate.limit|محاولات كثيرة/i.test(text);
  const messageRejected = /invalid credentials|incorrect password|wrong password|invalid email|do(es)? not match|credentials.*(incorrect|invalid|wrong)|unauthori[sz]ed|بيانات.*غير صحيحة|كلمة المرور.*غير صحيحة/i.test(text);
  // A 401/422 from the login endpoint that is not explained by another session, a
  // verification step or throttling means the server refused the username/password.
  const statusRejected = (status === 401 || status === 422) && !otherSession && !verificationRequired && !rateLimited;
  return { credentialsRejected: messageRejected || statusRejected, otherSession, verificationRequired, rateLimited };
}
module.exports = { classifyLogin };
