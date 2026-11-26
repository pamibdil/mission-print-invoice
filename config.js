module.exports = {
  store: {
    name: "Mission Print",
    address: "Belakang Seblak Teh Windy, Jl. HS. Ronggo Waluyo",
    phones: ["0895371709332", "0895331827838"],
    logoPath: "public/logo.png"
  },
  services: [
    { code: "J1", label: "75gsm print b&w/warna", price: 250 },
    { code: "J2", label: "75gsm fotocopy",        price: 180 },
    { code: "J3", label: "75gsm warna > 50%",     price: 450 },
    { code: "J4", label: "80gsm print b&w/warna", price: 270 },
    { code: "J5", label: "80gsm fotocopy",        price: 200 },
    { code: "J6", label: "80gsm warna > 50%",     price: 500 },
    { code: "J7", label: "Pengantaran (per 1 km)", price: 1500 }
  ],
  page: {
    width: 105 * 2.83465,   // A6 width pt
    height: 148 * 2.83465   // A6 height pt
  }
};
