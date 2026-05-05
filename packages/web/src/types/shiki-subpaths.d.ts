declare module 'shiki/langs/*' {
  import type { LanguageRegistration } from 'shiki';
  const lang: LanguageRegistration | LanguageRegistration[];
  export default lang;
}

declare module 'shiki/themes/*' {
  import type { ThemeRegistrationRaw } from 'shiki';
  const theme: ThemeRegistrationRaw;
  export default theme;
}
