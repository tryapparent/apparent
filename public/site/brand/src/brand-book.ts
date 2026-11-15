import { createNativeSlide } from './components/native-slide.ts';

const entries = [
  ['Point. Talk. Draw.', 'It’s the machine’s job to understand us, not our job to talk like a machine.', 'A more human way to make things with computers.', '/pond/frog-wave-cohesive.png'],
  ['Through fun, better products.', 'Play gives us room to experiment, follow our taste and try the peculiar idea.', 'We believe work should be enjoyable and leave us free for late nights with friends.', '/pond/belief/hug.png'],
  ['Have an idea. Show what you mean.', 'Record your screen, talk it through and draw the details. Hand the context to your coding agent.', 'The agent can use apparent to send a video walkthrough back.', '/pond/frog-air-cohesive.png'],
  ['Creative people. Their own taste.', 'People who already use coding agents for fun personal projects and value good design.', 'No design qualification, specialist vocabulary or particular technology stack required.', '/pond/frog-rest-cohesive.png'],
  ['Wonderfully weird. Effortless to use.', 'Warm, expressive and playful. Dependable when it matters.', 'Optional surprises reward curiosity. Capture and handoff never wait for a joke.', '/pond/frog-lounge-cohesive.png'],
  ['Speak like a person.', 'Point. Talk. Draw. Show your agent what you mean.', 'Keep errors, permissions and delivery states literal. Never invent capabilities or evidence.', '/pond/frog-wave-cohesive.png'],
  ['Keep the identity.', 'Use the supplied boxed wordmark. The boxed lowercase a is for compact identification.', 'Keep clear space. Never redraw, stretch, recolor or generate the lettering.', '/brand/assets/brand/apparent-wordmark.svg'],
  ['The same five colors.', 'Paper #F5F0E8 · Stock #E7E0EE · Carbon #020102 · Lilac #B7A5D8 · Signal #7A58C7.', 'Semantic status colors retain their jobs. Frog artwork is not an interface palette.', '/pond/frog-rest-cohesive.png'],
  ['Host Grotesk. Still us.', 'Use the existing typeface, weights and spacing system. Make hierarchy clear and text readable.', 'The personality comes from the expression, not a replacement font.', '/pond/frog-wave-cohesive.png'],
  ['Play you can join.', 'A frog you choose to make jump fits. An animation you must wait through does not.', 'Keep focus visible, respect reduced motion, and make controls work by keyboard.', '/pond/belief/jump-air.png'],
  ['A pond full of possibilities.', 'Reuse the original frogs. Keep chunky pixels, olive bodies, cream bellies and oversized eyes.', 'Attach the closest original as a reference for new artwork. Review the result beside it.', '/pond/belief/hug.png'],
  ['Show what actually happened.', 'Real capture demonstrates the product. Illustrations and examples are labeled as such.', 'A copied link is not proof a recording is ready to watch. Keep private material out of public examples.', '/pond/frog-rest-cohesive.png'],
  ['Build from the real components.', 'Button, Tabs, NativeSelect and StatusCard come from shared/ui. The brand page renders them live.', 'Inspect selected, disabled, waiting, empty, error and recovery states, not only the default.', '/pond/frog-wave-cohesive.png'],
  ['Make something peculiar.', 'Start with the wordmark, frog collection, tokens and live component reference.', 'Show personal creations and the pleasure of making. Keep life outside the screen in the story.', '/pond/frog-lounge-cohesive.png'],
  ['One current reference.', 'The reading view, agent-readable guidelines, component examples and asset index form the practical kit.', 'The old document-product campaign is historical material. This is the capture-product direction.', '/pond/belief/hug.png'],
];
function slide(index: number) {
  const [title, body, note, image] = entries[index];
  return createNativeSlide({ title, className: 'brand-slide apparent-brand-slide bb-v2 bb-kit-slide', markup: `
    <div class="bb-chrome"><span>apparent / brand guidelines</span><span>${index + 1} / ${entries.length}</span></div>
    <section class="bb-kit-copy"><h1>${title}</h1><p>${body}</p><p class="bb-kit-note">${note}</p></section>
    <img class="bb-kit-art" src="${image}" alt="${index === 6 ? 'apparent wordmark' : 'apparent frog artwork'}">
  ` });
}
export const renderBrandCover = () => slide(0);
export const renderBrandIdea = () => slide(1);
export const renderCustomerJourney = () => slide(2);
export const renderPositioning = () => slide(3);
export const renderCharacter = () => slide(4);
export const renderMessaging = () => slide(5);
export const renderLogoSystem = () => slide(6);
export const renderColorSystem = () => slide(7);
export const renderTypography = () => slide(8);
export const renderLayoutSystem = () => slide(9);
export const renderImagerySystem = () => slide(10);
export const renderDataSystem = () => slide(11);
export const renderApplications = () => slide(12);
export const renderChannels = () => slide(13);
export const renderGovernance = () => slide(14);
