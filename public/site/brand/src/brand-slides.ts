import { nativeSlide } from './components/slide-types.ts';

const load = (exportName) => () => import('./brand-book.ts')
  .then((module) => ({ default: module[exportName] }));

export const slides = [
  nativeSlide('apparent brand book', load('renderBrandCover')),
  nativeSlide('The brand idea', load('renderBrandIdea')),
  nativeSlide('The customer journey', load('renderCustomerJourney')),
  nativeSlide('Positioning hierarchy', load('renderPositioning')),
  nativeSlide('Brand character', load('renderCharacter')),
  nativeSlide('Messaging system', load('renderMessaging')),
  nativeSlide('Logo and icon system', load('renderLogoSystem')),
  nativeSlide('Color and accessibility', load('renderColorSystem')),
  nativeSlide('Typography', load('renderTypography')),
  nativeSlide('Layout and motion', load('renderLayoutSystem')),
  nativeSlide('Imagery', load('renderImagerySystem')),
  nativeSlide('Data visualization', load('renderDataSystem')),
  nativeSlide('Applications', load('renderApplications')),
  nativeSlide('Templates and channels', load('renderChannels')),
  nativeSlide('Assets and governance', load('renderGovernance')),
];
