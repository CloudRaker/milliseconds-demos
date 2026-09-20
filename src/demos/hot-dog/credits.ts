export interface Credit {
  id: string;
  /** The file name on Wikimedia Commons. */
  title: string;
  page: string;
  author: string;
  license: string;
  licenseUrl: string;
}

/**
 * Every stock photo comes from Wikimedia Commons. Public domain and CC0 files carry no condition;
 * the CC BY and CC BY-SA files require this credit, which the demo renders under "Photo credits".
 * The photos were downscaled and re-encoded, so each CC BY-SA file is a modified copy under the
 * same licence.
 */
export const CREDITS: Credit[] = [
  { id: "hotdog-classic", title: "Nice hot dog.jpg", page: "https://commons.wikimedia.org/wiki/File:Nice_hot_dog.jpg", author: "zorgum314", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0" },
  { id: "hotdog-macau", title: "Hot dog in Macau.jpg", page: "https://commons.wikimedia.org/wiki/File:Hot_dog_in_Macau.jpg", author: "Pauloleong2002", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" },
  { id: "hotdog-gourmet", title: "Hot dog gourmet.jpg", page: "https://commons.wikimedia.org/wiki/File:Hot_dog_gourmet.jpg", author: "Francesc Fort", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" },
  { id: "hotdog-pancho", title: "Pancho (Argentine Hot Dog) con salsa de palta, tomates y cebollas.jpg", page: "https://commons.wikimedia.org/wiki/File:Pancho_(Argentine_Hot_Dog)_con_salsa_de_palta,_tomates_y_cebollas.jpg", author: "Horacio Cambeiro", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" },
  { id: "hotdog-chili", title: "Harry's Cafe de Wheels Sonic the Hedgehog chilli dog.jpg", page: "https://commons.wikimedia.org/wiki/File:Harry%27s_Cafe_de_Wheels_Sonic_the_Hedgehog_chilli_dog.jpg", author: "DraftSaturn15", license: "CC0", licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" },
  { id: "hotdog-akasaka", title: "60m Hot Dog Akasaka Aug4 06.jpeg", page: "https://commons.wikimedia.org/wiki/File:60m_Hot_Dog_Akasaka_Aug4_06.jpeg", author: "Tim Lindenschmidt", license: "Public domain", licenseUrl: "" },
  { id: "burger", title: "Cheeseburger.jpg", page: "https://commons.wikimedia.org/wiki/File:Cheeseburger.jpg", author: "Renee Comet (photographer)", license: "Public domain", licenseUrl: "" },
  { id: "corn-dog", title: "Corn dog with mustard.jpg", page: "https://commons.wikimedia.org/wiki/File:Corn_dog_with_mustard.jpg", author: "Twodollarwhore", license: "CC0", licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" },
  { id: "bratwurst", title: "Rostbratwurstbrot.png", page: "https://commons.wikimedia.org/wiki/File:Rostbratwurstbrot.png", author: "barfisch", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0" },
  { id: "empty-buns", title: "2021-07-11 18 19 21 Two opened hot dog buns in the Dulles section of Sterling, Loudoun County, Virginia.jpg", page: "https://commons.wikimedia.org/wiki/File:2021-07-11_18_19_21_Two_opened_hot_dog_buns_in_the_Dulles_section_of_Sterling,_Loudoun_County,_Virginia.jpg", author: "Famartin", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" },
  { id: "sausages", title: "Grilling Sausages (Unsplash).jpg", page: "https://commons.wikimedia.org/wiki/File:Grilling_Sausages_(Unsplash).jpg", author: "The Digital Marketing Collaboration thedmcsa", license: "CC0", licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" },
  { id: "banana", title: "Banana on whitebackground.jpg", page: "https://commons.wikimedia.org/wiki/File:Banana_on_whitebackground.jpg", author: "Filo g\u00e8n'", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0" },
  { id: "dachshund", title: "Long-haired Dachshund Rosie.jpg", page: "https://commons.wikimedia.org/wiki/File:Long-haired_Dachshund_Rosie.jpg", author: "ScottCarammell", license: "CC0", licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" },
  { id: "taco", title: "Tacos al pastor.jpg", page: "https://commons.wikimedia.org/wiki/File:Tacos_al_pastor.jpg", author: "T.Tseng", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0" },
];
