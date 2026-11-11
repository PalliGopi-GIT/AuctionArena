import type { ClerkProviderProps } from '@clerk/react';

/** Product copy stays consistent even when the linked Clerk application has an internal name. */
export const auctionArenaLocalization: NonNullable<ClerkProviderProps['localization']> = {
  signIn: {
    start: {
      title: 'Sign in to AuctionArena',
      titleCombined: 'Continue to AuctionArena',
      subtitle: 'Welcome back! Sign in to join your auction.',
      subtitleCombined: 'Sign in or create an account to join your auction.',
      alternativePhoneCodeProvider: { title: 'Sign in to AuctionArena with {{provider}}' },
    },
    emailCode: { subtitle: 'to continue to AuctionArena' },
    emailLink: { subtitle: 'to continue to AuctionArena' },
    password: { subtitle: 'Enter your password to continue to AuctionArena.' },
  },
  signUp: {
    start: {
      title: 'Create your AuctionArena account',
      titleCombined: 'Join AuctionArena',
      subtitle: 'Build your squad. Bring your friends into the auction.',
      subtitleCombined: 'Create an account to join your auction.',
      alternativePhoneCodeProvider: { title: 'Sign up to AuctionArena with {{provider}}' },
    },
    emailLink: { subtitle: 'to continue to AuctionArena' },
  },
};
