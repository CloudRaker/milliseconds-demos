import { recordFrom, type Category } from './logic.ts';
// Fictional labelled inputs. Last ten are held out from the initial prompt design.
export const FIXTURES: { text: string; category: Category; missing: string[]; heldOut?: boolean }[] = [
  { text: 'Northline cotton T-shirt. Color: forest green. Size: medium.', category: 'apparel', missing: [] },
  { text: 'Oak & Field side table. Material: solid oak. Dimensions: 45 x 40 x 55 cm.', category: 'furniture', missing: [] },
  { text: 'Soundmere wireless headphones. Brand: Soundmere. Connectivity: Bluetooth 5.3. Color: black.', category: 'audio', missing: [] },
  { text: 'Soft everyday shirt in blue.', category: 'apparel', missing: ['material', 'size'] },
  { text: 'Linen blouse, size S, white.', category: 'apparel', missing: [] },
  { text: 'Black wool coat in XL.', category: 'apparel', missing: [] },
  { text: 'Cotton trousers, size 32, navy.', category: 'apparel', missing: [] },
  { text: 'Red polyester sports shirt. Size: large.', category: 'apparel', missing: [] },
  { text: 'Green T-shirt in small. Material not supplied.', category: 'apparel', missing: ['material'] },
  { text: 'Cotton shirt in size medium. No color provided.', category: 'apparel', missing: ['color'] },
  { text: 'Solid pine bookshelf, dimensions 80 x 30 x 180 cm.', category: 'furniture', missing: [] },
  { text: 'Steel desk, 48 x 24 x 30 inches.', category: 'furniture', missing: [] },
  { text: 'Birch stool, dimensions 400 x 400 x 450 mm.', category: 'furniture', missing: [] },
  { text: 'A handsome side table, dimensions 50 x 50 x 60 cm.', category: 'furniture', missing: ['material'] },
  { text: 'Solid walnut dining table. Dimensions available on request.', category: 'furniture', missing: ['dimensions'] },
  { text: 'Brand: Quietshore. USB-C microphone.', category: 'audio', missing: [] },
  { text: 'Brand: Echofield. Speaker with Bluetooth connectivity.', category: 'audio', missing: [] },
  { text: 'Headphones with a wired 3.5 mm connection. No brand supplied.', category: 'audio', missing: ['brand'] },
  { text: 'Brand: Auralane. Over-ear headphones. Connection information unavailable.', category: 'audio', missing: ['connectivity'] },
  { text: 'Book an hour of business coaching.', category: 'other', missing: [] },
  { text: 'Brand: Mossplain. Sweater in cream alpaca wool, size L.', category: 'apparel', missing: [], heldOut: true },
  { text: 'Denim jacket in blue. Size not stated.', category: 'apparel', missing: ['size'], heldOut: true },
  { text: 'Brand: Coastform. Orange cotton shorts, size M.', category: 'apparel', missing: [], heldOut: true },
  { text: 'Maple bench. Dimensions: 36 x 12 x 18 in.', category: 'furniture', missing: [], heldOut: true },
  { text: 'Dining chair. Seat height is adjustable. Material unspecified.', category: 'furniture', missing: ['material', 'dimensions'], heldOut: true },
  { text: 'Brand: Stillwood. Bamboo shelf, 600 x 200 x 900 mm.', category: 'furniture', missing: [], heldOut: true },
  { text: 'Brand: Pinewave. Portable speaker. Connection: Bluetooth 5.2.', category: 'audio', missing: [], heldOut: true },
  { text: 'Brand: Valeaudio. Headphones, cable and connection specifications not provided.', category: 'audio', missing: ['connectivity'], heldOut: true },
  { text: 'Please cancel my subscription and refund last month.', category: 'other', missing: [], heldOut: true },
  { text: 'A gift bundle containing both a cotton shirt and wireless headphones.', category: 'other', missing: [], heldOut: true },
];
export const SAMPLE = FIXTURES.slice(0, 4).map(f => f.text);
const values = [{ brand: 'Northline', material: 'cotton', color: 'forest green', size: 'medium' }, { brand: 'Oak & Field', material: 'solid oak', dimensions: '45 x 40 x 55 cm' }, { brand: 'Soundmere', connectivity: 'Bluetooth 5.3', color: 'black' }, { color: 'blue' }];
export const PREVIEW = SAMPLE.map((text, index) => recordFrom(text, { label: FIXTURES[index].category, probability: 1 }, { data: values[index] }));
