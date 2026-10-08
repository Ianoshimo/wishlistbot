const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const blend=(fg,a,bg)=>fg.map((c,i)=>Math.round(c*a+bg[i]*(1-a)));
const L=c=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return 0.2126*r+0.7152*g+0.0722*b};
const cr=(a,b)=>{const x=L(a),y=L(b);return ((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2)};
const W=hex('#ffffff'), BG=hex('#f5f4fb'), DS=hex('#211a35'), DB=hex('#15111f');
const rows=[
 ['light: "Занято" #d98a3d на warning-soft(.16) поверх #fff', hex('#d98a3d'), blend(hex('#d98a3d'),.16,W)],
 ['light: "Забронировано вами" #d98a3d на warning-soft поверх bg #f5f4fb', hex('#d98a3d'), blend(hex('#d98a3d'),.16,BG)],
 ['light: "Куплено"/успех #3e8f7a на success-soft(.14) поверх #fff', hex('#3e8f7a'), blend(hex('#3e8f7a'),.14,W)],
 ['light: белый текст на кнопке #4d3e99', W, hex('#4d3e99')],
 ['dark: белый текст на кнопке/FAB #8a7ae0', W, hex('#8a7ae0')],
 ['dark: "Свободно" #8a7ae0 на accent-soft(.18) поверх #211a35', hex('#8a7ae0'), blend(hex('#8a7ae0'),.18,DS)],
 ['dark: text-secondary #9c94b8 на #211a35', hex('#9c94b8'), DS],
 ['light: store Авито #00a046 на #fff', hex('#00a046'), W],
 ['light: highlight #9aad2e (звезда) на #fff', hex('#9aad2e'), W],
];
for (const [n,a,b] of rows) console.log(cr(a,b).padStart(5), n);
