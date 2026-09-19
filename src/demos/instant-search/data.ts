export type Category = "electronics" | "kitchen" | "outdoors" | "toys" | "office";
export const CATEGORIES: Category[] = ["electronics", "kitchen", "outdoors", "toys", "office"];

export interface Product {
  id: string;
  title: string;
  description: string;
  category: Category;
  type: string;
  attributes: Record<string, string>;
  price: number;
  rating: number;
  reviews: number;
}

interface Archetype {
  type: string;
  brands: string[];
  variants: string[];
  /** Plain strings are sampled; a nested array is a mutually exclusive group and contributes exactly one. */
  features: Array<string | string[]>;
  attributes: Record<string, string[]>;
  price: [number, number];
}

export const CATALOG_SIZE = 5000;
export const CATALOG_SEED = 20260917;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const E: Archetype[] = [
  { type: "Wireless Earbuds", brands: ["Aurex", "Sonique", "Nimbus", "Vela"], variants: ["Pro", "Lite", "Air", "Sport"], features: [["Open design leaks some sound to people nearby", "Snug silicone tips seal in your music so nothing leaks out"], "Active noise cancelling blocks commute noise", "30 hour battery with charging case", "Multipoint pairing to two devices", "Sweat resistant for workouts"], attributes: { color: ["black", "white", "navy", "sage"] }, price: [24, 199] },
  { type: "Over-Ear Headphones", brands: ["Aurex", "Kestrel Audio", "Tonn", "Vela"], variants: ["Studio", "Wired", "Pro", "Wireless"], features: [["Closed-back cups keep sound in and stop it leaking to the room", "Open-back design for a wide soundstage; audible to people around you"], "Plush memory foam earpads for long sessions", "Foldable with detachable cable", "40 mm drivers with balanced tuning", "Passive isolation for shared spaces"], attributes: { color: ["black", "silver", "burgundy"] }, price: [29, 349] },
  { type: "Mechanical Keyboard", brands: ["Keystone", "Tacto", "Nimbus", "Obsidian"], variants: ["TKL", "75%", "Full-Size", "60%"], features: [["Clicky blue switches with a loud, satisfying click", "Silent linear switches with dampened stems for near-silent typing", "Tactile brown switches that stay quiet enough for shared desks"], "Hot-swappable switches and PBT keycaps", "Sound-dampening foam layers inside the case", "RGB per-key backlight"], attributes: { layout: ["ANSI", "ISO"], connection: ["wired", "wireless"] }, price: [45, 220] },
  { type: "Low-Profile Keyboard", brands: ["Keystone", "Slate", "Tacto"], variants: ["Slim", "Wireless", "Compact"], features: ["Whisper-quiet scissor keys made for open-plan offices", "Slim aluminum body under 1 cm thick", "Bluetooth with three device slots", "Rechargeable, months of battery per charge", "Soft-touch keys with minimal noise"], attributes: { color: ["graphite", "silver", "white"] }, price: [29, 129] },
  { type: "Wireless Mouse", brands: ["Slate", "Tacto", "Nimbus"], variants: ["Ergo", "Silent", "Travel", "Gaming"], features: ["Silent clicks that will not disturb coworkers", "Ergonomic vertical shape reduces wrist strain", "Precision sensor works on glass", "USB-C rechargeable", "Six programmable buttons"], attributes: { color: ["black", "gray", "rose"] }, price: [15, 99] },
  { type: "Phone Case", brands: ["Bastion", "Forma", "Ridgeline", "Halo"], variants: ["Pro", "Clear", "Wallet", "Matte"], features: [["Military drop protection in a slim profile that adds almost no bulk", "Thick dual-layer shell for maximum protection; adds noticeable thickness", "Paper-thin case that shows off the phone with light scratch protection only"], "Raised bezel guards the screen and camera", "Grippy matte sides that resist fingerprints", "Built-in card slots for two cards", "Compatible with magnetic chargers"], attributes: { color: ["black", "clear", "forest", "sand"], fits: ["6.1 inch phones", "6.7 inch phones"] }, price: [9, 59] },
  { type: "Phone", brands: ["Vela", "Halo", "Ridgeline"], variants: ["Rugged", "Lite", "Max"], features: ["Rugged IP68 body built for jobsites", "Big 5000 mAh battery for two days of use", "Bright 6.6 inch display", "Dual camera with night mode"], attributes: { storage: ["128 GB", "256 GB"] }, price: [199, 899] },
  { type: "Bluetooth Speaker", brands: ["Sonique", "Tonn", "Nimbus"], variants: ["Mini", "Outdoor", "Home"], features: ["Waterproof and floats in the pool", "Room-filling 360 degree sound", "20 hour battery", "Pairs two speakers for stereo"], attributes: { color: ["black", "teal", "orange"] }, price: [25, 249] },
  { type: "Soundbar", brands: ["Tonn", "Sonique"], variants: ["2.1", "Compact", "Atmos"], features: ["Wireless subwoofer for deep bass", "Clear dialogue mode for movies", "HDMI ARC single-cable setup", "Low-profile design fits under any TV"], attributes: { channels: ["2.0", "2.1", "3.1"] }, price: [79, 499] },
  { type: "USB-C Hub", brands: ["Slate", "Portly", "Nimbus"], variants: ["7-in-1", "Travel", "Pro"], features: ["4K HDMI output", "100 W pass-through charging", "SD and microSD card slots", "Aluminum shell stays cool"], attributes: { ports: ["5", "7", "10"] }, price: [19, 89] },
  { type: "Power Bank", brands: ["Portly", "Vela", "Ridgeline"], variants: ["10000 mAh", "20000 mAh", "Slim", "Solar"], features: ["Charges a phone three times over", "Solar panel top-up for camping trips", "Fast 30 W USB-C output", "Pocket-sized and light"], attributes: { color: ["black", "white", "green"] }, price: [18, 79] },
  { type: "Smart Watch", brands: ["Vela", "Aurex", "Halo"], variants: ["Sport", "Classic", "Kids"], features: ["GPS run tracking", "Sleep and heart-rate monitoring", "Seven day battery", "Water resistant to 50 m"], attributes: { color: ["black", "silver", "coral"] }, price: [49, 399] },
  { type: "Webcam", brands: ["Slate", "Optic", "Nimbus"], variants: ["1080p", "4K", "Streaming"], features: ["Auto light correction for dim rooms", "Built-in stereo mics", "Privacy shutter", "Wide 90 degree field of view"], attributes: { resolution: ["1080p", "4K"] }, price: [29, 179] },
  { type: "Desk Fan", brands: ["Breeza", "Slate"], variants: ["Quiet", "USB", "Tower"], features: ["Near-silent motor rated at 25 dB", "Three speeds and oscillation", "USB powered", "Compact enough for a small desk"], attributes: { color: ["white", "black"] }, price: [15, 69] },
  { type: "Space Heater", brands: ["Breeza", "Hearth"], variants: ["Ceramic", "Compact", "Tower"], features: ["Heats a small room in minutes", "Tip-over and overheat protection", "Quiet fan mode", "Adjustable thermostat"], attributes: { watts: ["750", "1500"] }, price: [25, 129] },
  { type: "Hot Plate", brands: ["Hearth", "Vesta"], variants: ["Single", "Double", "Induction"], features: ["Portable cooking for dorms and offices", "Adjustable temperature dial", "Cast iron burner heats evenly", "Non-slip feet"], attributes: { burners: ["1", "2"] }, price: [22, 99] },
  { type: "Kids Tablet", brands: ["Halo", "Sprout"], variants: ["7 inch", "8 inch", "Pro"], features: ["Kid-proof bumper case", "Parental controls and screen time limits", "Preloaded learning games for ages 3 to 8", "Blue light filter"], attributes: { color: ["blue", "pink", "green"] }, price: [69, 199] },
  { type: "Noise Cancelling Headset", brands: ["Aurex", "Kestrel Audio"], variants: ["Office", "Call", "Travel"], features: ["Boom mic with background noise rejection for calls", "Closed-back cups so calls stay private and sound does not leak out", "Mute button on the earcup", "All-day comfort for meetings"], attributes: { color: ["black", "gray"] }, price: [59, 299] },
  { type: "E-Reader", brands: ["Halo", "Vela"], variants: ["Basic", "Paperlight", "Signature"], features: ["Glare-free screen readable in sunlight", "Weeks of battery", "Adjustable warm light", "Waterproof for the bath"], attributes: { storage: ["8 GB", "32 GB"] }, price: [89, 249] },
  { type: "Action Camera", brands: ["Optic", "Ridgeline"], variants: ["4K", "Mini", "Pro"], features: ["Waterproof to 10 m without a case", "Rock-steady stabilization", "Helmet and bike mounts included", "Voice control"], attributes: { resolution: ["4K", "5.3K"] }, price: [79, 399] },
];

const K: Archetype[] = [
  { type: "Insulated Travel Tumbler", brands: ["Thermik", "Vesta", "Ridgeline", "Kettleworks"], variants: ["16 oz", "20 oz", "12 oz", "Leakproof"], features: ["Double-wall vacuum insulation keeps drinks hot for 12 hours and cold for 24", "Leakproof flip lid you can toss in a bag", "Fits standard cup holders", "Powder-coated grip that will not sweat", "Dishwasher safe stainless steel"], attributes: { color: ["charcoal", "sage", "navy", "cream"], material: ["stainless steel"] }, price: [14, 45] },
  { type: "Vacuum Bottle", brands: ["Thermik", "Ridgeline", "Summit Supply"], variants: ["500 ml", "750 ml", "1 L", "Trail"], features: ["Keeps coffee steaming hot for 18 hours on the trail", "Rugged stainless steel that shrugs off drops", "Twist cup lid doubles as a mug", "Wide mouth fits ice cubes", "Carabiner loop for a pack strap"], attributes: { color: ["forest", "black", "orange", "steel"], material: ["stainless steel"] }, price: [18, 60] },
  { type: "Coffee Grinder", brands: ["Kettleworks", "Brewline", "Vesta"], variants: ["Burr", "Manual", "Electric", "Travel"], features: ["Conical burrs with 40 grind settings from espresso to French press", "Hand crank grinder that packs into a bag", "Quiet motor with anti-static chamber", "Removable hopper for easy cleaning"], attributes: { color: ["black", "silver", "copper"] }, price: [25, 189] },
  { type: "Coffee Maker", brands: ["Brewline", "Kettleworks", "Hearth"], variants: ["Drip 12-Cup", "Single Serve", "Pour-Over", "Cold Brew"], features: ["Programmable brewing so coffee is ready when you wake", "Hot plate keeps the carafe warm for two hours", "Reusable mesh filter", "Brew strength control"], attributes: { capacity: ["5 cups", "12 cups"] }, price: [24, 199] },
  { type: "Coffee Beans", brands: ["Brewline", "Ember Roasters", "Northlight"], variants: ["Medium Roast", "Dark Roast", "Espresso", "Decaf"], features: ["Whole bean, roasted in small batches", "Notes of chocolate, cherry and brown sugar", "Single origin, fair trade", "Nitrogen-flushed bag keeps beans fresh"], attributes: { weight: ["340 g", "907 g"] }, price: [11, 32] },
  { type: "French Press", brands: ["Kettleworks", "Vesta"], variants: ["350 ml", "1 L", "Insulated"], features: ["Double-wall steel keeps coffee hot longer than glass", "Fine mesh plunger for sediment-free coffee", "Heat-resistant borosilicate glass", "Dishwasher safe"], attributes: { material: ["glass", "stainless steel"] }, price: [18, 65] },
  { type: "Electric Kettle", brands: ["Kettleworks", "Brewline", "Hearth"], variants: ["Gooseneck", "1.7 L", "Variable Temp", "Travel"], features: ["Precise temperature control for tea and pour-over", "Boils a liter in under four minutes", "Keep-warm mode holds temperature for an hour", "Auto shut-off"], attributes: { color: ["black", "white", "copper"] }, price: [22, 149] },
  { type: "Cast Iron Skillet", brands: ["Hearth", "Vesta", "Ironwood"], variants: ["10 inch", "12 inch", "8 inch"], features: ["Pre-seasoned and ready to cook", "Oven safe to 500 degrees", "Even heat retention for searing", "Pour spouts on both sides"], attributes: { size: ["8 in", "10 in", "12 in"] }, price: [18, 79] },
  { type: "Nonstick Frying Pan", brands: ["Vesta", "Hearth"], variants: ["10 inch", "12 inch", "Set of 3"], features: ["Ceramic nonstick coating free of PFAS", "Stay-cool handle", "Induction compatible", "Dishwasher safe"], attributes: { size: ["10 in", "12 in"] }, price: [19, 89] },
  { type: "Chef Knife", brands: ["Ironwood", "Vesta", "Kaji"], variants: ["8 inch", "6 inch", "Santoku"], features: ["High-carbon steel holds a razor edge", "Full tang with a balanced walnut handle", "Hand-sharpened to 15 degrees", "Comes with a blade guard"], attributes: { length: ["6 in", "8 in"] }, price: [25, 189] },
  { type: "Cutting Board", brands: ["Ironwood", "Hearth"], variants: ["Bamboo", "Walnut", "Plastic Set"], features: ["Juice groove catches drips", "Reversible with a flat side for bread", "Gentle on knife edges", "Dishwasher safe plastic"], attributes: { size: ["small", "large"] }, price: [12, 89] },
  { type: "Food Storage Containers", brands: ["Vesta", "Tidy Home"], variants: ["10-Piece", "Glass Set", "Meal Prep"], features: ["Leakproof snap lids", "Stackable to save space in the fridge", "Microwave and freezer safe", "BPA-free"], attributes: { material: ["glass", "plastic"] }, price: [15, 59] },
  { type: "Blender", brands: ["Brewline", "Vesta", "Hearth"], variants: ["Personal", "High-Speed", "Immersion"], features: ["Crushes ice and frozen fruit for smoothies", "Portable cup doubles as the pitcher", "1200 W motor", "Self-cleaning cycle"], attributes: { color: ["black", "red", "white"] }, price: [25, 349] },
  { type: "Air Fryer", brands: ["Hearth", "Vesta"], variants: ["4 qt", "6 qt", "Dual Basket"], features: ["Crispy results with little oil", "Dishwasher safe basket", "Eight presets", "Quiet fan"], attributes: { capacity: ["4 qt", "6 qt"] }, price: [49, 199] },
  { type: "Thermal Lunch Box", brands: ["Thermik", "Tidy Home"], variants: ["Adult", "Kids", "Jar"], features: ["Insulated food jar keeps soup hot until lunch", "Leakproof lid", "Fits a sandwich, fruit and a drink", "Wipe-clean lining"], attributes: { color: ["gray", "blue", "green"] }, price: [12, 45] },
  { type: "Hot Sauce Gift Set", brands: ["Ember Roasters", "Northlight"], variants: ["6-Pack", "Mild to Wild", "Smoky"], features: ["Six small-batch sauces from mild to extra hot", "Gift box with tasting notes", "No artificial preservatives"], attributes: { heat: ["mild", "hot", "extra hot"] }, price: [19, 49] },
  { type: "Spice Rack", brands: ["Tidy Home", "Ironwood"], variants: ["Rotating", "Wall Mount", "Drawer"], features: ["Holds 20 labeled jars", "Saves counter space", "Bamboo lid included", "Refillable jars"], attributes: { jars: ["12", "20"] }, price: [22, 79] },
  { type: "Camping Cook Set", brands: ["Summit Supply", "Ridgeline"], variants: ["2-Person", "Solo", "Family"], features: ["Nesting pots and pan pack into one bundle", "Folding handles", "Hard-anodized aluminum", "Mesh carry bag"], attributes: { pieces: ["6", "10"] }, price: [25, 95] },
  { type: "Popcorn Maker", brands: ["Hearth", "Brewline"], variants: ["Hot Air", "Stovetop", "Microwave"], features: ["Hot air popping with no oil", "Pops a bowl in three minutes", "Butter melting tray", "Easy to clean"], attributes: { color: ["red", "white"] }, price: [18, 59] },
  { type: "Wine Glasses", brands: ["Vesta", "Northlight"], variants: ["Set of 4", "Stemless", "Crystal"], features: ["Lead-free crystal", "Dishwasher safe", "Thin rim for tasting", "Gift boxed"], attributes: { count: ["4", "6"] }, price: [18, 89] },
];

const O: Archetype[] = [
  { type: "Hiking Boots", brands: ["Ridgeline", "Summit Supply", "Trailhead"], variants: ["Mid", "Low", "Waterproof", "Lightweight"], features: ["Waterproof membrane keeps feet dry on wet trails", "Grippy lugged outsole", "Ankle support for rough terrain", "Breathable mesh panels"], attributes: { size: ["8", "9", "10", "11"], color: ["brown", "gray", "olive"] }, price: [59, 229] },
  { type: "Hiking Daypack", brands: ["Ridgeline", "Trailhead", "Summit Supply"], variants: ["20 L", "28 L", "35 L", "Ultralight"], features: ["Hydration sleeve and hose port", "Hip belt pockets for snacks", "Rain cover tucked in the base", "Ventilated back panel", "Bottle pockets fit a large flask"], attributes: { color: ["forest", "black", "rust"] }, price: [35, 159] },
  { type: "Trekking Poles", brands: ["Trailhead", "Summit Supply"], variants: ["Carbon", "Aluminum", "Folding"], features: ["Collapsible to fit inside a pack", "Cork grips that wick sweat", "Shock absorbing tips", "Weighs under 250 g per pole"], attributes: { material: ["carbon", "aluminum"] }, price: [29, 149] },
  { type: "Camping Tent", brands: ["Summit Supply", "Ridgeline", "Trailhead"], variants: ["2-Person", "4-Person", "Backpacking", "Family"], features: ["Pitches in five minutes", "Full rainfly for storms", "Vestibule for muddy boots", "Packs down to the size of a loaf of bread"], attributes: { season: ["3-season", "4-season"] }, price: [69, 449] },
  { type: "Sleeping Bag", brands: ["Summit Supply", "Ridgeline"], variants: ["20 F", "40 F", "Down", "Kids"], features: ["Rated to 20 degrees F", "Compresses into a small stuff sack", "Draft collar keeps heat in", "Machine washable"], attributes: { fill: ["down", "synthetic"] }, price: [39, 329] },
  { type: "Headlamp", brands: ["Trailhead", "Ridgeline"], variants: ["300 lm", "500 lm", "Rechargeable"], features: ["Red night mode preserves vision", "Rechargeable via USB-C", "Waterproof to IPX7", "Tilting head"], attributes: { lumens: ["300", "500"] }, price: [15, 69] },
  { type: "Camp Stove", brands: ["Summit Supply", "Trailhead"], variants: ["Canister", "Two-Burner", "Pocket"], features: ["Boils water for coffee in three minutes", "Folds to fit in a pocket", "Piezo igniter", "Simmer control"], attributes: { fuel: ["canister", "propane"] }, price: [22, 149] },
  { type: "Water Bottle", brands: ["Ridgeline", "Thermik", "Trailhead"], variants: ["Insulated 32 oz", "Tritan 1 L", "Collapsible", "Filter"], features: ["Insulated steel keeps water cold all day and coffee hot for hours", "Leakproof cap", "Built-in filter for stream water", "Collapses flat when empty"], attributes: { color: ["blue", "green", "black"] }, price: [12, 49] },
  { type: "Rain Jacket", brands: ["Ridgeline", "Trailhead"], variants: ["Packable", "Shell", "Insulated"], features: ["Waterproof breathable fabric", "Packs into its own pocket", "Pit zips for venting", "Adjustable hood"], attributes: { size: ["S", "M", "L", "XL"], color: ["yellow", "navy", "black"] }, price: [45, 249] },
  { type: "Camp Chair", brands: ["Summit Supply", "Trailhead"], variants: ["Compact", "Recliner", "Kids"], features: ["Folds into a small carry bag", "Cup holder in the armrest", "Supports 300 lb", "Weighs 2 lb"], attributes: { color: ["green", "blue", "gray"] }, price: [25, 129] },
  { type: "Binoculars", brands: ["Optic", "Trailhead"], variants: ["8x42", "10x42", "Compact"], features: ["Bright multi-coated lenses", "Waterproof and fog proof", "Rubber armor", "Tripod adaptable"], attributes: { magnification: ["8x", "10x"] }, price: [39, 299] },
  { type: "Hammock", brands: ["Trailhead", "Summit Supply"], variants: ["Single", "Double", "With Straps"], features: ["Parachute nylon holds 400 lb", "Tree straps included", "Packs to the size of a grapefruit", "Quick-dry"], attributes: { color: ["teal", "orange", "gray"] }, price: [20, 89] },
  { type: "Cooler", brands: ["Ridgeline", "Summit Supply"], variants: ["Soft 24-Can", "Hard 45 qt", "Backpack"], features: ["Holds ice for three days", "Leakproof liner", "Bottle opener on the side", "Padded shoulder strap"], attributes: { capacity: ["24 can", "45 qt"] }, price: [29, 299] },
  { type: "Yoga Mat", brands: ["Flowform", "Trailhead"], variants: ["6 mm", "Travel", "Cork"], features: ["Non-slip grip even when sweaty", "Extra thick for knees", "Carry strap included", "Free of PVC"], attributes: { color: ["purple", "black", "sand"] }, price: [18, 99] },
  { type: "Running Shoes", brands: ["Flowform", "Ridgeline"], variants: ["Road", "Trail", "Racer"], features: ["Responsive foam midsole", "Breathable knit upper", "Grippy outsole for wet roads", "Reflective details"], attributes: { size: ["8", "9", "10", "11"] }, price: [59, 189] },
  { type: "Bike Light Set", brands: ["Trailhead", "Optic"], variants: ["USB", "Bright", "Mini"], features: ["Front and rear lights", "Rechargeable via USB", "Five modes", "Tool-free mounting"], attributes: { lumens: ["400", "800"] }, price: [15, 59] },
  { type: "Fishing Rod Combo", brands: ["Summit Supply", "Trailhead"], variants: ["Spinning", "Telescopic", "Kids"], features: ["Telescopic rod fits in a backpack", "Reel pre-spooled with line", "Cork handle", "Carry case"], attributes: { length: ["6 ft", "7 ft"] }, price: [29, 129] },
  { type: "Picnic Blanket", brands: ["Trailhead", "Tidy Home"], variants: ["Waterproof", "Oversized", "Compact"], features: ["Waterproof backing", "Folds into a tote with handle", "Sand proof", "Machine washable"], attributes: { color: ["plaid", "blue", "green"] }, price: [18, 59] },
  { type: "Kids Bike Helmet", brands: ["Sprout", "Trailhead"], variants: ["Toddler", "Youth", "Space Print"], features: ["Adjustable fit dial", "Rocket and planet print kids love", "Magnetic buckle that will not pinch", "Extra vents"], attributes: { color: ["blue", "pink", "galaxy"] }, price: [22, 59] },
  { type: "Garden Hose", brands: ["Tidy Home", "Hearth"], variants: ["50 ft", "Expandable", "100 ft"], features: ["Kink resistant", "Expands to three times its length", "Brass fittings", "Spray nozzle included"], attributes: { length: ["50 ft", "100 ft"] }, price: [19, 79] },
];

const T: Archetype[] = [
  { type: "Solar System Model Kit", brands: ["Sprout", "Orbit Labs", "Brightwood"], variants: ["Glow-in-the-Dark", "Motorized", "Paint Your Own"], features: ["Build and paint all eight planets; ages 6 and up", "Glow-in-the-dark planets light up a bedroom ceiling", "Motorized orbit shows how planets move around the sun", "Includes a fact poster about space"], attributes: { ages: ["6+", "8+"] }, price: [16, 49] },
  { type: "Rocket Launcher Toy", brands: ["Sprout", "Orbit Labs"], variants: ["Stomp", "Air Pressure", "Glow"], features: ["Stomp on the pad to launch foam rockets 100 feet", "Safe foam rockets for ages 5 and up", "Great backyard gift for kids who love space", "Adjustable launch angle"], attributes: { rockets: ["4", "6"] }, price: [14, 39] },
  { type: "Brick Set", brands: ["Brightwood", "Orbit Labs"], variants: ["Space Shuttle", "Moon Base", "Mars Rover"], features: ["Snap-together bricks build a spacecraft with astronaut figures; ages 6 to 10", "Illustrated step-by-step booklet", "Compatible with major brick brands", "Comes in a gift-ready box"], attributes: { pieces: ["250", "420", "600"] }, price: [19, 69] },
  { type: "Star Projector Night Light", brands: ["Orbit Labs", "Sprout"], variants: ["Galaxy", "Rotating", "Bluetooth"], features: ["Projects planets and stars onto the ceiling", "Rotating night sky with timer", "Soft glow for bedtime", "Kid-friendly buttons"], attributes: { color: ["black", "white"] }, price: [15, 49] },
  { type: "Astronaut Costume", brands: ["Sprout", "Brightwood"], variants: ["Kids Small", "Kids Medium", "With Helmet"], features: ["Jumpsuit with mission patches", "Inflatable helmet included", "Machine washable", "Fits ages 5 to 8"], attributes: { size: ["S", "M", "L"] }, price: [22, 59] },
  { type: "Kids Telescope", brands: ["Orbit Labs", "Optic"], variants: ["Beginner", "Tabletop", "Refractor"], features: ["See the moon's craters and Saturn's rings", "Simple two-finger focus for small hands", "Tripod and finder scope included", "Star map for beginners"], attributes: { aperture: ["50 mm", "70 mm"] }, price: [35, 129] },
  { type: "Building Blocks Set", brands: ["Brightwood", "Sprout"], variants: ["Classic 500", "Castle", "City", "Dinosaur"], features: ["Colorful bricks for open-ended building", "Storage tub included", "Ages 4 and up", "Compatible with major brick brands"], attributes: { pieces: ["300", "500", "1000"] }, price: [15, 79] },
  { type: "Remote Control Car", brands: ["Sprout", "Velocity Toys"], variants: ["Off-Road", "Stunt", "Mini"], features: ["Flips and drives on both sides", "Rechargeable battery with 30 minutes of play", "Rugged tires for dirt and grass", "Ages 6 and up"], attributes: { scale: ["1:18", "1:24"] }, price: [19, 89] },
  { type: "Board Game", brands: ["Brightwood", "Tabletop Tales"], variants: ["Family", "Strategy", "Party", "Cooperative"], features: ["30 minute rounds for game night", "Two to six players", "Ages 8 and up", "Easy rules to learn"], attributes: { players: ["2-4", "2-6"] }, price: [15, 59] },
  { type: "Jigsaw Puzzle", brands: ["Tabletop Tales", "Brightwood"], variants: ["500 Piece", "1000 Piece", "Kids 100 Piece", "Space 300 Piece"], features: ["Thick recycled board pieces", "Poster included", "Planets and rockets artwork", "Ages 6 and up for the 100 piece"], attributes: { pieces: ["100", "300", "500", "1000"] }, price: [10, 29] },
  { type: "Plush Toy", brands: ["Sprout", "Cuddleworks"], variants: ["Bunny", "Dinosaur", "Astronaut Bear", "Sloth"], features: ["Ultra-soft and huggable", "Machine washable", "Safe for all ages", "Embroidered eyes"], attributes: { size: ["12 in", "18 in"] }, price: [9, 35] },
  { type: "Science Experiment Kit", brands: ["Orbit Labs", "Brightwood"], variants: ["Chemistry", "Volcano", "Crystals", "Slime"], features: ["20 experiments with safe ingredients", "Illustrated guide for ages 8 and up", "Real lab tools included", "Great gift for curious kids"], attributes: { experiments: ["12", "20", "30"] }, price: [18, 59] },
  { type: "Art Supplies Set", brands: ["Brightwood", "Sprout"], variants: ["Deluxe 150", "Watercolor", "Markers 48"], features: ["Crayons, markers, pencils and pastels in a wooden case", "Non-toxic and washable", "Ages 5 and up", "Includes drawing pad"], attributes: { pieces: ["48", "150"] }, price: [15, 59] },
  { type: "Dollhouse", brands: ["Sprout", "Cuddleworks"], variants: ["Wooden", "3-Story", "Cottage"], features: ["Furnished with 15 pieces", "Sturdy wood that lasts", "Ages 3 and up", "Open back for easy play"], attributes: { floors: ["2", "3"] }, price: [49, 189] },
  { type: "Toy Kitchen", brands: ["Sprout", "Brightwood"], variants: ["Wooden", "Compact", "Deluxe"], features: ["Play stove with clicking knobs", "Includes pots and food set", "Ages 3 and up", "Chalkboard panel"], attributes: { color: ["white", "pink", "gray"] }, price: [59, 199] },
  { type: "Walkie Talkies", brands: ["Sprout", "Velocity Toys"], variants: ["Kids", "Long Range", "Rechargeable"], features: ["Two mile range for backyard missions", "Simple push-to-talk for ages 5 and up", "Belt clips", "Flashlight built in"], attributes: { color: ["blue", "green", "pink"] }, price: [18, 49] },
  { type: "Toy Cars Set", brands: ["Velocity Toys", "Sprout"], variants: ["Hot Rods 10-Pack", "Die-Cast 20-Pack", "Track Set"], features: ["Die-cast metal cars", "Compatible with looping track", "Ages 3 and up", "Collector case"], attributes: { count: ["10", "20"] }, price: [12, 49] },
  { type: "Learning Tablet", brands: ["Sprout", "Halo"], variants: ["Preschool", "Alphabet", "Math"], features: ["Teaches letters, numbers and songs", "Volume control for quiet play", "Ages 3 to 6", "Durable for drops"], attributes: { color: ["blue", "purple"] }, price: [15, 49] },
  { type: "Kite", brands: ["Trailhead", "Sprout"], variants: ["Delta", "Rocket", "Beginner"], features: ["Flies in light wind", "Rocket shaped with streamer tail", "Easy for ages 5 and up", "String and winder included"], attributes: { color: ["rainbow", "blue", "red"] }, price: [10, 35] },
  { type: "Magnetic Tiles", brands: ["Brightwood", "Orbit Labs"], variants: ["60 Piece", "100 Piece", "Glow"], features: ["Strong magnets snap into 3D shapes", "Translucent colors for light tables", "Ages 3 and up", "Idea booklet included"], attributes: { pieces: ["60", "100"] }, price: [29, 99] },
];

const F: Archetype[] = [
  { type: "Office Chair", brands: ["Ergo Haus", "Slate", "Formwell"], variants: ["Mesh", "Executive", "Task", "Kneeling"], features: ["Breathable mesh back", "Adjustable lumbar support", "Silent casters for hard floors", "Armrests flip up to slide under the desk"], attributes: { color: ["black", "gray", "white"] }, price: [89, 599] },
  { type: "Standing Desk", brands: ["Formwell", "Ergo Haus"], variants: ["Electric", "Manual Crank", "Converter"], features: ["Quiet dual motors lift 250 lb", "Four memory heights", "Cable tray included", "Anti-collision sensor"], attributes: { width: ["48 in", "60 in"] }, price: [149, 899] },
  { type: "Desk Lamp", brands: ["Slate", "Luma", "Formwell"], variants: ["LED", "Architect", "Clamp"], features: ["Five color temperatures", "Touch dimmer", "USB charging port in the base", "Folds flat"], attributes: { color: ["black", "white", "silver"] }, price: [19, 129] },
  { type: "Monitor Arm", brands: ["Formwell", "Slate"], variants: ["Single", "Dual", "Gas Spring"], features: ["Frees up desk space", "Fits monitors to 32 inches", "Cable management channel", "Clamp or grommet mount"], attributes: { screens: ["1", "2"] }, price: [29, 199] },
  { type: "Keyboard Cover", brands: ["Slate", "Tacto"], variants: ["Silicone", "Clear", "Dust"], features: ["Silicone skin protects against spills", "Ultra thin so keys still feel normal", "Washable", "Fits standard full-size keyboards"], attributes: { color: ["clear", "black"] }, price: [6, 19] },
  { type: "Noise-Reducing Desk Divider", brands: ["Formwell", "Hush Panels"], variants: ["24 inch", "Clamp-On", "Acoustic"], features: ["Absorbs chatter in open-plan offices", "Clamps to any desk edge", "Felt surface takes pins", "Recycled PET"], attributes: { color: ["gray", "blue", "green"] }, price: [39, 149] },
  { type: "Notebook", brands: ["Paperline", "Northlight"], variants: ["Dotted A5", "Lined", "Hardcover", "Pocket"], features: ["192 pages of thick paper with no bleed-through", "Lay-flat binding", "Elastic closure and back pocket", "Numbered pages with index"], attributes: { color: ["black", "teal", "sand"] }, price: [8, 29] },
  { type: "Fountain Pen", brands: ["Paperline", "Kaji"], variants: ["Fine", "Medium", "Gift Set"], features: ["Smooth steel nib", "Converter and cartridges included", "Brass body with lacquer finish", "Gift boxed"], attributes: { nib: ["fine", "medium"] }, price: [15, 149] },
  { type: "Gel Pen Set", brands: ["Paperline", "Brightwood"], variants: ["12 Colors", "Black 24-Pack", "Retractable"], features: ["Quick-dry ink that does not smear", "0.5 mm fine tip", "Comfort grip", "Refillable"], attributes: { count: ["12", "24"] }, price: [6, 24] },
  { type: "Laptop Stand", brands: ["Slate", "Formwell", "Portly"], variants: ["Aluminum", "Folding", "Adjustable"], features: ["Raises the screen to eye level", "Folds flat for travel", "Vented to keep laptops cool", "Fits 11 to 17 inch laptops"], attributes: { color: ["silver", "space gray"] }, price: [19, 79] },
  { type: "Laptop Bag", brands: ["Portly", "Ridgeline"], variants: ["Rugged", "Slim Sleeve", "Messenger", "Backpack"], features: ["Rugged water-resistant canvas", "Padded 15 inch laptop sleeve", "Trolley strap for travel", "Hidden back pocket"], attributes: { size: ["13 in", "15 in", "16 in"] }, price: [25, 149] },
  { type: "Whiteboard", brands: ["Formwell", "Paperline"], variants: ["Magnetic 36x24", "Glass", "Desktop"], features: ["Magnetic surface holds notes", "Wipes clean without ghosting", "Marker tray included", "Mounts landscape or portrait"], attributes: { size: ["24x18", "36x24", "48x36"] }, price: [19, 199] },
  { type: "Desk Organizer", brands: ["Tidy Home", "Formwell"], variants: ["Mesh", "Bamboo", "Drawer"], features: ["Saves desk space with stacked trays", "Slots for pens, phone and notes", "Sturdy steel mesh", "Non-slip base"], attributes: { color: ["black", "natural"] }, price: [12, 49] },
  { type: "Printer Paper", brands: ["Paperline", "Northlight"], variants: ["500 Sheets", "Ream Case", "Recycled"], features: ["Bright white 20 lb", "Jam-free in laser and inkjet", "Acid free", "Made from recycled fiber"], attributes: { sheets: ["500", "2500"] }, price: [7, 49] },
  { type: "Label Maker", brands: ["Paperline", "Slate"], variants: ["Bluetooth", "Handheld", "Pro"], features: ["Prints from a phone app", "Dozens of fonts and icons", "Tapes in five colors", "Rechargeable"], attributes: { color: ["white", "black"] }, price: [25, 99] },
  { type: "Paper Shredder", brands: ["Formwell", "Tidy Home"], variants: ["8-Sheet", "Micro-Cut", "12-Sheet"], features: ["Micro-cut for sensitive documents", "Quiet motor for shared offices", "Shreds cards and staples", "Pull-out bin"], attributes: { sheets: ["8", "12"] }, price: [39, 199] },
  { type: "Footrest", brands: ["Ergo Haus", "Formwell"], variants: ["Adjustable", "Memory Foam", "Rocking"], features: ["Improves posture at a desk", "Rocking motion keeps legs moving", "Washable cover", "Non-slip bottom"], attributes: { color: ["black", "gray"] }, price: [19, 69] },
  { type: "Wall Calendar", brands: ["Paperline", "Northlight"], variants: ["Large Planner", "Dry Erase", "Monthly"], features: ["Big daily boxes with room to write", "Dry erase for reuse every month", "Hangs from a single nail", "Includes markers"], attributes: { size: ["17x12", "24x36"] }, price: [9, 39] },
  { type: "Gift Card Holder", brands: ["Paperline", "Northlight"], variants: ["Set of 12", "Kraft", "Holiday"], features: ["Fits standard gift cards", "Envelopes included", "Blank inside for a note", "Recycled paper"], attributes: { count: ["6", "12"] }, price: [5, 15] },
  { type: "Conference Speakerphone", brands: ["Aurex", "Slate"], variants: ["USB", "Bluetooth", "Pro"], features: ["360 degree microphone pickup", "Echo cancellation", "Plug and play with any meeting app", "Touch mute"], attributes: { connection: ["USB", "Bluetooth"] }, price: [59, 349] },
];

const ARCHETYPES: Record<Category, Archetype[]> = { electronics: E, kitchen: K, outdoors: O, toys: T, office: F };

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function pickN<T>(rand: () => number, arr: T[], n: number): T[] {
  const pool = arr.slice();
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

export function generateCatalog(size = CATALOG_SIZE, seed = CATALOG_SEED): Product[] {
  const rand = mulberry32(seed);
  const products: Product[] = [];
  const perCategory = Math.ceil(size / CATEGORIES.length);
  for (const category of CATEGORIES) {
    const list = ARCHETYPES[category];
    for (let i = 0; i < perCategory && products.length < size; i++) {
      const a = list[i % list.length];
      const brand = pick(rand, a.brands);
      const variant = pick(rand, a.variants);
      const groups = a.features.filter((f): f is string[] => Array.isArray(f));
      const singles = a.features.filter((f): f is string => typeof f === "string");
      const features = [...groups.map((g) => pick(rand, g)), ...pickN(rand, singles, Math.max(0, 3 - groups.length))];
      const attributes: Record<string, string> = {};
      for (const [k, vals] of Object.entries(a.attributes)) attributes[k] = pick(rand, vals);
      const [lo, hi] = a.price;
      const price = Math.round((lo + (hi - lo) * rand() ** 1.4) * 100) / 100;
      const rating = Math.round((3.4 + rand() * 1.6) * 10) / 10;
      const reviews = Math.floor(rand() ** 2 * 4000) + 3;
      const id = `${category.slice(0, 2)}-${String(products.length + 1).padStart(4, "0")}`;
      const attrText = Object.values(attributes).join(", ");
      products.push({
        id,
        title: `${brand} ${a.type} ${variant}`,
        description: `${features.join(". ")}. ${attrText}.`,
        category,
        type: a.type,
        attributes,
        price,
        rating,
        reviews,
      });
    }
  }
  return products;
}

export function catalogFingerprint(products: Product[]): string {
  let h = 2166136261;
  for (const p of products) {
    const s = `${p.id}|${p.title}|${p.description}|${p.price}|${p.rating}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export const EXAMPLES = [
  "something to keep coffee hot on a hike",
  "quiet keyboard for open office",
  "gift for a 6 yr old who likes space",
  "cheap headphones that dont leak sound",
  "rugged phone case not bulky",
];
