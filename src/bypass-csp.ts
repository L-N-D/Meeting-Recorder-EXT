// Bypass Trusted Types CSP on restricted pages like teams.microsoft.com
if (typeof window !== 'undefined') {
  try {
    Object.defineProperty(window, 'trustedTypes', {
      value: undefined,
      configurable: true,
      enumerable: true,
      writable: true
    });
    console.log('Trusted Types security checks bypassed for Extension isolated context.');
  } catch (e) {
    console.warn('Failed to override trustedTypes in isolated context:', e);
  }
}
