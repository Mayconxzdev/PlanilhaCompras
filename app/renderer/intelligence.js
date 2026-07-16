/* ProcureFlow — motor de busca industrial estruturado e extração assistida.
 * Regras gerais, sem condicionais para produtos específicos.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ProcureFlowIntelligence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "2.2.0";
  const PROFILE_VERSION = "2.2.0-r11";
  const STOP = new Set(["a","o","as","os","de","da","do","das","dos","e","em","para","por","com","sem","um","uma","uns","umas","p","c","x","no","na","nos","nas","ao","aos"]);
  const MARKETPLACES = ["mercadolivre", "mercadolibre", "amazon", "shopee", "magazineluiza", "americanas", "aliexpress"];
  const KNOWN_MANUFACTURERS = ["3m","weg","tigre","tramontina","bosch","siemens","schneider","legrand","vonder","wurth","norton","makita","dewalt","skf","ntn","timken","parker","swagelok","gerdau","usiminas","arcelormittal","csn","villares","adere","tekbond","loctite","scotch","steck","abb","wago"];

  const TYPE_DEFS = [
    ["prensa_cabo", ["prensa cabo", "prensa-cabo", "prensacabo"]],
    ["barra_roscada", ["barra roscada", "barra rosqueada", "barra de rosca", "haste roscada"]],
    ["barra_chata", ["barra chata", "b chata", "bc"]],
    ["barra_redonda", ["barra redonda", "barra red", "vergalhao"]],
    ["reducao", ["reducao excentrica", "reducao concentrica", "reducao", "redutor"]],
    ["bucha", ["bucha de reducao", "bucha reducao", "bucha fixacao", "bucha"]],
    ["cotovelo", ["cotovelo", "joelho"]],
    ["niple", ["niple", "nipple"]],
    ["valvula", ["valvula", "registro"]],
    ["uniao", ["uniao"]],
    ["conexao", ["conexao", "conector", "adaptador"]],
    ["chapa", ["chapa", "chapas", "ch.", "folha metalica", "lamina", "ff", "fq"]],
    ["cantoneira", ["cantoneira", "cantoneiras", "perfil l"]],
    ["tubo", ["tubo", "tubos", "tubulacao"]],
    ["tarugo", ["tarugo", "tarugos"]],
    ["flange", ["flange", "flanges"]],
    ["perfil", ["perfil t", "perfil tee", "perfil"]],
    ["parafuso", ["parafuso", "parafusos", "paraf."]],
    ["porca", ["porca", "porcas"]],
    ["arruela", ["arruela", "arruelas"]],
    ["rebite", ["rebite", "rebites"]],
    ["chumbador", ["chumbador", "chumbadores"]],
    ["arame", ["arame", "arames", "fio solda", "fio de solda"]],
    ["tela", ["tela", "telas", "malha"]],
    ["fita", ["silver tape", "fita adesiva", "fita", "fitas"]],
    ["adesivo", ["adesivo", "adesivos", "cola", "vedante"]],
    ["cabo", ["cabo", "cabos"]],
    ["plugue", ["plugue", "plugues"]],
    ["tomada", ["tomada", "tomadas"]],
    ["eletroduto", ["eletroduto", "eletrodutos"]],
    ["painel", ["painel", "paineis", "botoeira", "involucro"]],
    ["capacitor", ["capacitor", "capacitores"]],
    ["contator", ["contator", "contatores"]],
    ["rele", ["rele", "reles"]],
    ["chave", ["chave", "chaves"]],
    ["rodizio", ["rodizio", "rodizios", "roda"]],
    ["helice", ["helice", "helices"]],
    ["mangueira", ["mangueira", "mangueiras"]],
    ["solda", ["eletrodo", "solda", "mig", "tig", "bico macarico"]],
    ["filtro", ["filtro", "filtros", "elemento filtrante"]],
    ["embalagem", ["caixa papelao", "pallet", "filme stretch", "plastico bolha", "embalagem", "bobina"]],
    ["abracadeira", ["abracadeira", "grampo"]],
    ["terminal", ["terminal", "terminais"]],
    ["rolamento", ["rolamento", "rolamentos"]],
    ["retentor", ["retentor", "retentores"]],
    ["manometro", ["manometro", "manometros"]],
    ["fusivel", ["fusivel", "fusiveis"]],
    ["disjuntor", ["disjuntor", "disjuntores"]],
    ["sinaleira", ["sinaleira", "sinaleiras"]]
  ];

  const TYPE_LABELS = {
    prensa_cabo:"Prensa-cabo", barra_roscada:"Barra roscada", barra_chata:"Barra chata", barra_redonda:"Barra redonda", reducao:"Redução", bucha:"Bucha", cotovelo:"Cotovelo", niple:"Niple", valvula:"Válvula/registro", uniao:"União", conexao:"Conexão", chapa:"Chapa", cantoneira:"Cantoneira", tubo:"Tubo", tarugo:"Tarugo", flange:"Flange", perfil:"Perfil", parafuso:"Parafuso", porca:"Porca", arruela:"Arruela", rebite:"Rebite", chumbador:"Chumbador", arame:"Arame", tela:"Tela", fita:"Fita", adesivo:"Adesivo/cola", cabo:"Cabo", plugue:"Plugue", tomada:"Tomada", eletroduto:"Eletroduto", painel:"Painel/botoeira", capacitor:"Capacitor", contator:"Contator", rele:"Relé", chave:"Chave", rodizio:"Rodízio", helice:"Hélice", mangueira:"Mangueira", solda:"Material de solda", filtro:"Filtro", embalagem:"Embalagem", abracadeira:"Abraçadeira/grampo", terminal:"Terminal", rolamento:"Rolamento", retentor:"Retentor", manometro:"Manômetro", fusivel:"Fusível", disjuntor:"Disjuntor", sinaleira:"Sinaleira"
  };

  const MATERIAL_DEFS = [
    ["inox", ["aco inoxidavel", "aco inox", "inox", "stainless"]],
    ["aco_carbono", ["aco carbono", "ferro", "carbon steel"]],
    ["aco_galvanizado", ["aco galvanizado", "ferro galvanizado", "galvanizado"]],
    ["aluminio", ["aluminio"]], ["bronze", ["bronze"]], ["latao", ["latao"]], ["cobre", ["cobre"]],
    ["pvc", ["pvc"]], ["borracha", ["borracha"]], ["nbr", ["nbr"]], ["epdm", ["epdm"]],
    ["nylon", ["nylon", "poliamida"]], ["poliuretano", ["poliuretano", "pu"]],
    ["fibra_vidro", ["fibra de vidro"]], ["papelao", ["papelao", "triplex"]], ["madeira", ["pinus", "madeira"]]
  ];

  const UNIT_BY_TYPE = { fita:"rolo", cabo:"m", mangueira:"m", arame:"kg", tela:"m²", chapa:"un", barra_roscada:"barra", barra_chata:"barra", barra_redonda:"barra", tubo:"barra", cantoneira:"barra", perfil:"barra", parafuso:"un", porca:"un", arruela:"un", rebite:"un", rodizio:"un", plugue:"un", tomada:"un", prensa_cabo:"un", eletroduto:"un", adesivo:"un", embalagem:"un" };

  const TYPO_ALIASES = new Map([
    ["chpa","chapa"],["cahpa","chapa"],["chpaa","chapa"],["inxo","inox"],["inoxd","inox"],["inoxidvael","inoxidavel"],
    ["parafso","parafuso"],["parafuzo","parafuso"],["parafsuo","parafuso"],["arrula","arruela"],["aruuela","arruela"],
    ["cantoneir","cantoneira"],["cantoneia","cantoneira"],["mangera","mangueira"],["manguera","mangueira"],
    ["rolamnto","rolamento"],["rolamto","rolamento"],["abracdeira","abracadeira"],["abracadera","abracadeira"],
    ["eletrodto","eletroduto"],["eletroduo","eletroduto"],["siler","silver"],["scoth","scotch"],["aluminioo","aluminio"],
    ["conecao","conexao"],["manometo","manometro"],["galvanisado","galvanizado"],["silicnone","silicone"],
    ["vedanet","vedante"],["retentorr","retentor"],["disjunto","disjuntor"],["lubrifcante","lubrificante"]
  ]);

  const ABBR_MAP = new Map([
    ["cant","cantoneira"],["cantn","cantoneira"],["manom","manometro"],["pcabo","prensa cabo"],
    ["eletrod","eletroduto"],["arr","arruela"],["abrac","abracadeira"],["ret","retentor"],["rol","rolamento"],
    ["paraf","parafuso"],["cx","caixa"],["pct","pacote"],["qtd","quantidade"],["comp","comprimento"],
    ["larg","largura"],["esp","espessura"],["diam","diametro"],["galvan","galvanizado"],["pneum","pneumatica"],
    ["conex","conexao"],["valv","valvula"],["inoxid","inox"],["cap","capacitor"],
    ["ch","chapa"],["cha","chapa"],["chap","chapa"]
  ]);

  const TECHNICAL_WORDS = new Set(["mm","cm","m","mt","mm2","m2","kg","g","l","lt","ml","v","kv","a","uf","nf","pf","hz","bar","psi","w","kw","cv","hp","rpm","sch","schedule","fios","fio","pos","polos","polo","dn","ip"]);
  const PROFILE_CACHE = new WeakMap();
  const INDEX_CACHE = new WeakMap();
  const QUICK_TEXT_CACHE = new WeakMap();

  function cleanUnicode(value="") {
    return String(value ?? "").normalize("NFKC")
      .replace(/\uFEFF/g, "")
      .replace(/[\u200B-\u200D\u2060\u00AD]/g, "")
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
      .replace(/\u00A0/g, " ");
  }
  function clean(value="") { return cleanUnicode(value).replace(/\s+/g," ").trim(); }
  function stripAccents(value="") { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
  function regexEscape(value="") { return String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
  function unique(values) { return [...new Set((values||[]).filter((x)=>x!==undefined&&x!==null&&x!==""))]; }
  function canonicalNumber(value) {
    const n=Number(value);
    if(!Number.isFinite(n)) return "";
    return String(Number(n.toFixed(6)));
  }
  function fractionToNumber(raw) {
    const s=String(raw||"").trim().replace(",",".");
    let m=s.match(/^(\d+)[.\s](\d+)\/(\d+)$/); if(m&&Number(m[3])&&Number(m[1])<=99)return Number(m[1])+Number(m[2])/Number(m[3]);
    m=s.match(/^(\d+)\/(\d+)$/); if(m&&Number(m[2]))return Number(m[1])/Number(m[2]);
    const n=Number(s); return Number.isFinite(n)?n:null;
  }
  function normalizeFractions(text) {
    const map={"½":"1/2","⅓":"1/3","⅔":"2/3","¼":"1/4","¾":"3/4","⅛":"1/8","⅜":"3/8","⅝":"5/8","⅞":"7/8","⅒":"1/10"};
    let s=String(text||"").replace(/⁄/g,"/");
    for(const [u,f] of Object.entries(map)) s=s.replace(new RegExp(u,"g"),` ${f}`);
    return s.replace(/(^|[^0-9])(\d{1,2})\s+(\d+)\/(\d+)/g,"$1$2.$3/$4");
  }
  function parseColloquialText(text) {
    return cleanUnicode(text).toLowerCase()
      .replace(/\bdois e meio\b/g,"2.5").replace(/\bum e meio\b/g,"1.5")
      .replace(/\btres e vinte e cinco\b/g,"3.25").replace(/\btrinta e dois\b/g,"32")
      .replace(/\bcento e vinte e sete\b/g,"127").replace(/\bduzentos e vinte\b/g,"220")
      .replace(/\btres oitavos\b/g,"3/8").replace(/\bum quarto\b/g,"1/4").replace(/\bmeia polegada\b/g,"1/2")
      .replace(/\bcom borracha dos dois lados\b/g,"2rs").replace(/\bblindagem dos dois lados\b/g,"zz");
  }
  function normalize(value="") {
    let s=stripAccents(normalizeFractions(parseColloquialText(value))).toLowerCase()
      .replace(/[\u2010-\u2015\u2212]/g,"-").replace(/[“”″]/g,'"').replace(/[’´`]/g,"'").replace(/×/g," x ")
      .replace(/(?<=\d),(?=\d)/g,".")
      .replace(/\bporca\s+sext\b/g,"porca sextavada").replace(/\baco\s+carb\b/g,"aco carbono")
      .replace(/\barr\.?\s*lisa\b/g,"arruela lisa").replace(/\barr\.?\s*pressao\b/g,"arruela pressao")
      .replace(/\bp\.?\s*(?:\/\s*)?cabo\b/g,"prensa cabo").replace(/\bmat\.?\s*eletrico\b/g,"material eletrico")
      .replace(/\btubo\s+s\s*\/\s*c\b/g,"tubo sem costura").replace(/\btubo\s+c\s*\/\s*c\b/g,"tubo com costura")
      .replace(/\baco\s+(?:inoxidavel|inox)\b/g,"inox")
      .replace(/\b(304|316|310|321|409|410|420|430|440)\s+l\b/g,"$1l")
      .replace(/\bmilimetros?\b/g,"mm").replace(/\bcentimetros?\b/g,"cm").replace(/\bmetros?\b|\bmts?\b/g,"m")
      .replace(/\bpolegadas?\b|\bpol\.?\b|\binch(?:es)?\b/g,'"')
      .replace(/\blitros?\b/g,"l").replace(/\bmililitros?\b/g,"ml").replace(/\bquilos?\b|\bquilogramas?\b/g,"kg")
      .replace(/\bprensa[\s-]?cabo\b/g,"prensa cabo");
    s=s.replace(/[^a-z0-9#/+.,\-"'²° ]+/g," ").replace(/\s+/g," ").trim();
    s=s.split(" ").map((token)=>ABBR_MAP.get(token.replace(/\.$/,""))||TYPO_ALIASES.get(token)||token).join(" ");
    return s.replace(/\s+/g," ").trim();
  }
  function tokenise(value="") {
    return normalize(value).split(/\s+/).map((t)=>t.replace(/^[.,;:()\[\]]+|[.,;:()\[\]]+$/g,"")).filter((t)=>t&&/[a-z0-9]/.test(t)&&!STOP.has(t));
  }
  function levenshtein(a,b,maxDistance=Infinity) {
    a=String(a);b=String(b);if(a===b)return 0;if(!a)return b.length;if(!b)return a.length;
    if(Math.abs(a.length-b.length)>maxDistance)return maxDistance+1;
    const prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);
    for(let i=1;i<=a.length;i++){
      cur[0]=i;let rowMin=cur[0];
      for(let j=1;j<=b.length;j++){cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));if(cur[j]<rowMin)rowMin=cur[j];}
      if(rowMin>maxDistance)return maxDistance+1;
      for(let j=0;j<=b.length;j++)prev[j]=cur[j];
    }
    return prev[b.length];
  }
  function adjacentTransposition(a,b){
    if(a.length!==b.length)return false;const diff=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])diff.push(i);
    return diff.length===2&&diff[1]===diff[0]+1&&a[diff[0]]===b[diff[1]]&&a[diff[1]]===b[diff[0]];
  }
  function fuzzyEquals(a,b) {
    if(a===b)return true;
    if(!a||!b||/\d/.test(a)||/\d/.test(b)||a.length<4||b.length<4)return false;
    const min=Math.min(a.length,b.length),max=min>=9?2:1;
    if(Math.abs(a.length-b.length)>max)return false;
    return adjacentTransposition(a,b)||levenshtein(a,b,max)<=max;
  }
  function phrasePresent(text,alias){const n=normalize(text),a=normalize(alias);if(!a)return false;return new RegExp(`(?:^|\\s)${regexEscape(a).replace(/\\ /g,"\\s+")}(?=$|\\s)`).test(n);}
  function wordPrefixPresent(text,token){const n=normalize(text),t=normalize(token);if(!t||t.length<3)return false;return tokenise(n).some(w=>w===t||w.startsWith(t)||t.startsWith(w)&&w.length>=4);}
  function detectFromDefs(text,defs){const n=normalize(text),tokens=tokenise(n),set=new Set(tokens);let best=null;for(const [key,aliases] of defs){for(const alias of aliases){const a=normalize(alias);if(!a||!phrasePresent(n,a))continue;const at=tokenise(a),score=(n===a?5000:0)+(n.startsWith(`${a} `)||n===a?1500:0)+at.length*250+a.length-(GENERIC_TYPES.has(key)?600:0);if(!best||score>best.score)best={key,score};}}for(const [key,aliases] of defs){const candidates=aliases.filter((a,i)=>{const at=tokenise(a);if(i===0||at.length>1)return true;const word=at[0]||"";return !(word.endsWith("s")&&aliases.some(other=>normalize(other)===word.slice(0,-1)));});for(const alias of candidates){const at=tokenise(alias);if(!at.length)continue;let exact=0,fuzzy=0,ok=true;for(const a of at){if(set.has(a)){exact++;continue;}if(a.length>=5&&tokens.some(t=>fuzzyEquals(a,t))){fuzzy++;continue;}ok=false;break;}if(ok){const starts=tokens[0]&&at[0]&&(tokens[0]===at[0]||fuzzyEquals(tokens[0],at[0]));const score=at.length*200+exact*50+fuzzy*20+(starts?1200:0)-(GENERIC_TYPES.has(key)?600:0);if(!best||score>best.score)best={key,score};}}}return best?.key||"";}
  function detectType(text){return detectFromDefs(text,TYPE_DEFS);}
  function detectMaterials(text){
    const n=normalize(text),tokens=tokenise(n),out=[];
    for(const [key,aliases] of MATERIAL_DEFS){
      const hit=aliases.some(alias=>phrasePresent(n,alias)||tokenise(alias).every(a=>tokens.some(t=>t===a||fuzzyEquals(a,t))));
      if(hit)out.push(key);
    }
    return unique(out);
  }
  function detectMaterial(text){return detectMaterials(text)[0]||"";}

  const ALLOY_RE=/\b(?:aisi\s*)?(?:f)?(304l?|316l?|201|202|310s?|321|409|410|420|430|440|1010|1018|1020|1045|4140|4340|8620|a36|3003|4043|5052f?|6061|6063|7075|2024)\b/gi;
  function detectAlloys(text){const out=[];let m;const re=new RegExp(ALLOY_RE.source,"gi"),n=normalize(text);while((m=re.exec(n)))out.push(String(m[1]||m[0]).toUpperCase().replace(/^F(?=304|316)/,""));return unique(out);}
  function detectThreads(text){const n=normalize(text),out=[];let m;const re=/\b(npt|bspt?|bsp|unc|unf|m\d+(?:\.\d+)?|dn\s*\d+)\b/gi;while((m=re.exec(n)))out.push(m[1].toUpperCase().replace(/\s+/g,""));return unique(out);}
  function detectSchedule(text){const m=normalize(text).match(/\b(?:sch|schedule)\s*(\d+)\b/);return m?String(Number(m[1])):"";}

  function fact(kind,value,unit,raw,role="",strict=true){return {kind,value,unit:unit||"",raw:clean(raw),role,strict};}
  function addFact(list,item){if(item.value===""||item.value===null||item.value===undefined)return;const same=list.some((x)=>x.kind===item.kind&&x.role===item.role&&String(x.value)===String(item.value));if(!same)list.push(item);}
  function numericUnit(value,unit){
    const n=fractionToNumber(value);if(n===null)return null;const u=String(unit||"").toLowerCase();
    if(u==='"'||u==='in'||u==='pol')return ["length",n*25.4,"mm"];
    if(u==='mm')return ["length",n,"mm"];if(u==='cm')return ["length",n*10,"mm"];if(u==='m'||u==='mt')return ["length",n*1000,"mm"];
    if(u==='mm2'||u==='mm²')return ["area",n,"mm2"];if(u==='m2'||u==='m²')return ["surface",n,"m2"];
    if(u==='g')return ["mass",n,"g"];if(u==='kg')return ["mass",n*1000,"g"];
    if(u==='ml')return ["volume",n,"ml"];if(u==='l'||u==='lt')return ["volume",n*1000,"ml"];
    if(u==='v')return ["voltage",n,"v"];if(u==='kv')return ["voltage",n*1000,"v"];
    if(u==='a')return ["current",n,"a"];if(u==='ma')return ["current",n/1000,"a"];
    if(u==='uf'||u==='µf')return ["capacitance",n,"uf"];if(u==='nf')return ["capacitance",n/1000,"uf"];if(u==='pf')return ["capacitance",n/1000000,"uf"];
    if(u==='hz')return ["frequency",n,"hz"];if(u==='khz')return ["frequency",n*1000,"hz"];
    if(u==='bar')return ["pressure",n*100,"kpa"];if(u==='psi')return ["pressure",n*6.894757,"kpa"];
    if(u==='w')return ["power",n,"w"];if(u==='kw')return ["power",n*1000,"w"];if(u==='cv')return ["power",n*735.49875,"w"];if(u==='hp')return ["power",n*745.699872,"w"];
    if(u==='rpm')return ["speed",n,"rpm"];
    return null;
  }
  function canonicalSpecLabel(label=""){
    const n=normalize(label);
    if(/largura|width/.test(n))return "Largura";if(/comprimento(?: do rolo)?|length/.test(n))return "Comprimento";
    if(/espessura|thickness/.test(n))return "Espessura";if(/diametro|diameter/.test(n))return "Diâmetro";if(/altura|height/.test(n))return "Altura";
    if(/capacidade|peso|weight/.test(n))return "Capacidade / peso";if(/cor|color/.test(n))return "Cor";if(/tensao|voltage/.test(n))return "Tensão";
    if(/corrente|amper/.test(n))return "Corrente";if(/potencia|power|motor/.test(n))return "Potência";if(/pressao|pressure/.test(n))return "Pressão";
    if(/protecao|protection/.test(n))return "Proteção";if(/medida original/.test(n))return "Medida original";if(/equivalencia/.test(n))return "Equivalência";
    if(/medida|dimension|size/.test(n))return "Medida";if(/liga|alloy/.test(n))return "Liga";if(/rosca/.test(n))return "Rosca";
    if(/schedule|\bsch\b/.test(n))return "Schedule";if(/polos?/.test(n))return "Polos";if(/posicao|posicoes/.test(n))return "Posição";if(/fios?/.test(n))return "Fios";
    return clean(label)||"Característica";
  }
  function roleForLabel(label=""){
    const n=normalize(label);if(/largura/.test(n))return "width";if(/comprimento/.test(n))return "length";if(/espessura/.test(n))return "thickness";if(/diametro/.test(n))return "diameter";if(/altura/.test(n))return "height";return "";
  }
  function parseDimensions(text="",contextType=""){
    const raw=normalizeFractions(String(text||"")).replace(/[“”″]/g,'"').replace(/×/g," x ");
    const val=String.raw`(?:\d{1,2}[.\s]\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)`,unit=String.raw`(?:mm2|mm²|mm|cm|mt|m|in|pol|\")`;
    const out=[];let m;const chains=new RegExp(`(?<![A-Za-z0-9])(${val})\\s*(${unit})?\\s*[xX]\\s*(${val})\\s*(${unit})?(?:\\s*[xX]\\s*(${val})\\s*(${unit})?)?(?![A-Za-z0-9])`,'gi');
    while((m=chains.exec(raw))){
      const values=[m[1],m[3],m[5]].filter(Boolean), explicit=m[6]||m[4]||m[2]||"";
      let inherited=explicit;
      if(!inherited&&(contextType==="chapa"||contextType==="tela")){
        const nums=values.map(v=>fractionToNumber(v)).filter(v=>v!==null);
        inherited=nums.length&&Math.max(...nums)<=10?"m":"mm";
      }
      [[m[1],m[2]],[m[3],m[4]],[m[5],m[6]]].forEach(([v,u],idx)=>{
        if(!v)return;
        let resolved=u||inherited;
        if(!u&&String(v).includes("/"))resolved='"';
        const parsed=numericUnit(v,resolved);
        if(parsed&&parsed[0]==="length")out.push({raw:clean(`${v}${resolved||""}`),value:Number(parsed[1].toFixed(4)),unit:"mm",position:idx});
      });
    }
    const singles=new RegExp(`(?<![A-Za-z0-9])(${val})\\s*(${unit})(?![A-Za-z0-9])`,'gi');while((m=singles.exec(raw))){const parsed=numericUnit(m[1],m[2]);if(parsed&&parsed[0]==="length")out.push({raw:clean(`${m[1]} ${m[2]}`),value:Number(parsed[1].toFixed(4)),unit:"mm"});}
    return out;
  }
  function parseFacts(text="",specs=[],contextType=""){
    const n=normalize(text),facts=[],used=new Set();
    const pattern=/\b(\d+[.\s]\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*(mm2|mm²|m2|m²|mm|cm|mt|m|kg|g|ml|lt|l|kv|v|ma|a|uf|µf|nf|pf|khz|hz|bar|psi|kw|w|cv|hp|rpm)\b/gi;
    let m;while((m=pattern.exec(n))){
      const unit=String(m[2]||"").toLowerCase();
      if(unit==="l"&&detectAlloys(m[0]).length)continue;
      const parsed=numericUnit(m[1],m[2]);if(parsed){addFact(facts,fact(parsed[0],Number(parsed[1].toFixed(6)),parsed[2],m[0]));const original=fractionToNumber(m[1]);if(original!==null)used.add(canonicalNumber(original));}
    }
    if(contextType==="cabo"){
      const cableRe=/(?:^|\s)(\d{1,3})\s*[xX]\s*(\d+(?:\.\d+)?)\s*(?:mm2|mm²|mm)?\b/g;
      while((m=cableRe.exec(n))){addFact(facts,fact("conductors",Number(m[1]),"",m[0],"count"));addFact(facts,fact("area",Number(m[2]),"mm2",m[0],"section"));used.add(canonicalNumber(m[1]));used.add(canonicalNumber(m[2]));}
    }
    for(const d of parseDimensions(text,contextType)){
      if(contextType==="cabo"&&d.position!==undefined)continue;
      addFact(facts,fact("length",d.value,"mm",d.raw,d.position!==undefined?`position:${d.position}`:""));const rawNum=normalize(d.raw).match(/\d+(?:[.\s]\d+\/\d+|\/\d+|(?:\.\d+)?)/)?.[0];const original=fractionToNumber(rawNum);if(original!==null)used.add(canonicalNumber(original));
    }
    const stringPatterns=[
      ["protection",/\bip\s*(\d{2,3}[a-z]?)\b/gi,(x)=>`IP${x.toUpperCase()}`],
      ["poles",/\b(\d+)\s*p(?:\+n)?(?:\+t)?\b/gi,(x)=>Number(x)],
      ["positions",/\b(\d+)\s*pos(?:icoes?)?\b/gi,(x)=>Number(x)],
      ["wires",/\b(\d+)\s*fios?\b/gi,(x)=>Number(x)],
      ["conductors",/\b(\d+)\s*(?:condutores?|vias?)\b/gi,(x)=>Number(x)],
      ["mesh",/\bmalha\s*(\d+(?:\.\d+)?)\b/gi,(x)=>Number(x)],
      ["grade",/\b(?:grao|gr)\s*(\d+)\b/gi,(x)=>Number(x)]
    ];
    for(const [kind,re,conv] of stringPatterns){while((m=re.exec(n))){addFact(facts,fact(kind,conv(m[1]),"",m[0]));const original=fractionToNumber(m[1]);if(original!==null)used.add(canonicalNumber(original));}}
    for(const spec of specs||[]){const label=canonicalSpecLabel(spec?.label||""),value=clean(spec?.value||"");if(!value)continue;const role=roleForLabel(label);const parsed=parseFacts(value,[],contextType).facts;for(const x of parsed)addFact(facts,{...x,role:role||x.role});if(label==="Polos"&&/^\d+$/.test(normalize(value)))addFact(facts,fact("poles",Number(normalize(value)),"",value));if(label==="Posição"&&/\d+/.test(value))addFact(facts,fact("positions",Number(value.match(/\d+/)[0]),"",value));if(label==="Fios"&&/\d+/.test(value))addFact(facts,fact("wires",Number(value.match(/\d+/)[0]),"",value));}
    const numberTokens=[];const numRe=/(?:^|\s)(\d+[.]\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?=$|\s|["'])/g;while((m=numRe.exec(` ${n} `))){const v=fractionToNumber(m[1]);if(v!==null)numberTokens.push(canonicalNumber(v));}
    return {facts,numberTokens:unique(numberTokens),consumedNumbers:[...used]};
  }
  function detectTechnical(text){return parseFacts(text).facts.map((f)=>`${f.kind}:${f.value}`);}
  function factTolerance(kind,value){const v=Math.abs(Number(value)||0);if(["length","mass","volume","voltage","current","capacitance","frequency","pressure","power","speed","area","surface"].includes(kind))return Math.max(kind==="length"?0.3:0.001,v*0.005);return 0;}
  function factsEqual(a,b){if(a.kind!==b.kind)return false;if(a.role&&b.role&&a.role!==b.role)return false;if(typeof a.value==="number"&&typeof b.value==="number")return Math.abs(a.value-b.value)<=Math.max(factTolerance(a.kind,a.value),factTolerance(b.kind,b.value));return String(a.value).toUpperCase()===String(b.value).toUpperCase();}

  function productText(p={}){return normalize([p.name,p.displayName,p.technicalName,p.subtitle,p.description,p.family,p.group,p.category,p.manufacturer,p.brand,p.productLine,(p.aliases||[]).join(" "),(p.originalLines||[]).slice(0,8).join(" "),(p.specs||[]).flatMap((s)=>[s.label,s.value]).join(" ")].join(" "));}
  function productSignature(p={}){return [p.name,p.displayName,p.technicalName,p.family,p.group,p.productType,p.manufacturer,p.brand,p.productLine,p.code,p.manufacturerCode,p.gtin,JSON.stringify(p.specs||[])].join("¦");}
  function quickProductText(p={}){
    const signature=productSignature(p)+`¦${(p.offers||[]).map(o=>o.supplierName).join("¦")}¦${(p.supplierLinks||[]).map(s=>s.name).join("¦")}`;
    const cached=QUICK_TEXT_CACHE.get(p);
    if(cached&&cached.signature===signature)return cached.text;
    const text=normalize([p.name,p.displayName,p.technicalName,p.subtitle,p.description,p.family,p.group,p.category,p.productType,p.manufacturer,p.brand,p.productLine,p.code,p.manufacturerCode,p.gtin,(p.externalCodes||[]).join(" "),(p.aliases||[]).join(" "),(p.specs||[]).flatMap((s)=>[s.label,s.value]).join(" "),(p.supplierLinks||[]).map(s=>s.name).join(" "),(p.offers||[]).map(o=>o.supplierName).join(" ")].join(" "));
    QUICK_TEXT_CACHE.set(p,{signature,text});
    return text;
  }
  function quickTokenPresent(text,token){
    const t=normalize(token);if(!t)return true;
    if(text.includes(` ${t} `)||text.startsWith(`${t} `)||text.endsWith(` ${t}`)||text===t)return true;
    if(t.length>=3)return text.split(" ").some(w=>w.startsWith(t)||t.startsWith(w)&&w.length>=4);
    return false;
  }
  function queryQuickTokens(intent){
    const tokens=[];
    if(intent.type){const def=TYPE_DEFS.find(([key])=>key===intent.type);tokenise(def?.[1]?.[0]||TYPE_LABELS[intent.type]||intent.type).forEach(t=>tokens.push(t));}
    for(const material of (intent.materials?.length?intent.materials:(intent.material?[intent.material]:[]))){const def=MATERIAL_DEFS.find(([key])=>key===material);tokenise(def?.[1]?.[0]||material).forEach(t=>tokens.push(t));}
    intent.alloys.forEach(a=>tokens.push(normalize(a)));
    intent.threads.forEach(t=>tokenise(t).forEach(x=>tokens.push(x)));
    if(intent.schedule)tokens.push(intent.schedule);
    intent.modelTokens.forEach(t=>tokens.push(t));
    intent.textTokens.forEach(t=>tokens.push(t));
    intent.facts.forEach(f=>tokenise(f.raw).filter(t=>!TECHNICAL_WORDS.has(t)).forEach(t=>tokens.push(t)));
    return unique(tokens).filter(t=>t&&t.length>=2);
  }
  function queryNumberNeedles(intent){
    const rawNumbers=String(intent.raw||"").match(/\d+[.]\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?/g)||[];
    return unique([...(intent.numberTokens||[]),...rawNumbers.map(n=>normalize(n))]).filter(Boolean);
  }
  function quickCandidateProducts(list,intent){
    if(!intent.raw)return list;
    const compact=intent.compact;
    if(intent.codeLike)return list.filter(p=>[p.code,p.manufacturerCode,p.gtin,...(p.externalCodes||[])].some(c=>normalize(c).replace(/[^a-z0-9]/g,"").startsWith(compact)));
    const tokens=queryQuickTokens(intent);
    if(!tokens.length)return list;
    return list.filter(p=>{if(intent.type&&p.productType&&!compatibleTypes(intent.type,p.productType))return false;const text=` ${quickProductText(p)} `;return tokens.every(t=>quickTokenPresent(text,t));});
  }
  function simpleRankProducts(products,intent){
    const tokens=queryQuickTokens(intent),numberNeedles=queryNumberNeedles(intent);
    return products.map(product=>{const text=` ${quickProductText(product)} `,nameText=normalize([product.name,product.displayName,product.technicalName,product.subtitle].join(" ")),nameTokens=new Set(tokenise(nameText));let score=10000;for(const token of tokens){if(nameTokens.has(token))score+=2200;else if(text.includes(` ${token} `))score+=1200;else if(quickTokenPresent(text,token))score+=700;}for(const number of numberNeedles){if(text.includes(` ${number} `)||text.includes(`${number}\"`)||text.includes(`${number}”`)||text.includes(`${number} mm`)||text.includes(`${number} m`))score+=5200;else score-=900;}if(intent.type){const def=TYPE_DEFS.find(([key])=>key===intent.type),typeTokens=tokenise(def?.[1]?.[0]||TYPE_LABELS[intent.type]||intent.type),typeInName=typeTokens.some(t=>nameTokens.has(t));if(product.productType===intent.type)score+=2600;if(typeInName)score+=5200;else score-=2200;}score+=Math.min(500,(product.offers||[]).length*5);const matches=[];if(intent.type)matches.push(`tipo ${TYPE_LABELS[intent.type]||intent.type}`);for(const material of (intent.materials?.length?intent.materials:(intent.material?[intent.material]:[])))matches.push(`material ${material.replace(/_/g," ")}`);intent.alloys.forEach(alloy=>matches.push(`liga ${alloy}`));numberNeedles.slice(0,3).forEach(number=>matches.push(`número ${number}`));intent.textTokens.slice(0,3).forEach(token=>matches.push(token));if(!matches.length)matches.push("correspondência textual");return {product,score,tier:2,rejected:false,matches:unique(matches),mismatches:[],missing:[],intent,profile:{type:intent.type||"",main:text}};}).sort((a,b)=>b.score-a.score||lastOfferTime(b.product)-lastOfferTime(a.product)||String(a.product.name).localeCompare(String(b.product.name),"pt-BR"));
  }
  function buildProductProfile(p={}){
    const cached=PROFILE_CACHE.get(p);if(cached)return cached.profile;
    const signature=productSignature(p);
    if(p.searchProfile&&p.searchProfile._version===PROFILE_VERSION&&p.searchProfile._signature===signature){
      const stored={...p.searchProfile};delete stored._version;delete stored._signature;stored.tokenSet=new Set(stored.tokens||[]);PROFILE_CACHE.set(p,{signature,profile:stored});return stored;
    }
    const name=normalize(p.name),family=normalize([p.family,p.group,p.category].join(" ")),main=productText(p);
    const type=p.productType||detectType(name)||detectType(family),specText=(p.specs||[]).map(s=>`${s.label||""} ${s.value||""}`).join(" ");
    const materials=unique([...detectMaterials(`${name} ${specText}`),...detectMaterials(family)]),material=materials[0]||"",nameParsed=parseFacts(`${p.name||""}`,[],type),specFacts=[];
    for(const spec of (p.specs||[])){
      const sp=parseFacts("",[spec],type);
      for(const f of sp.facts){const hasSameRole=f.role&&nameParsed.facts.some(n=>n.kind===f.kind&&n.role===f.role);const hasKindWithoutRole=!f.role&&nameParsed.facts.some(n=>n.kind===f.kind);if(!hasSameRole&&!hasKindWithoutRole)specFacts.push(f);}
    }
    const profileAlloys=detectAlloys(`${name} ${(p.specs||[]).map(s=>s.value).join(" ")}`),allFacts=[...nameParsed.facts,...specFacts];
    const factNumbers=unique(allFacts.flatMap(f=>{const raw=normalize(f.raw).match(/\d+(?:[.\s]\d+\/\d+|\/\d+|(?:\.\d+)?)/)?.[0],v=fractionToNumber(raw);return [canonicalNumber(f.value),v===null?"":canonicalNumber(v)];}));
    const parsed={facts:allFacts,numberTokens:nameParsed.numberTokens.filter(n=>!nameParsed.consumedNumbers.includes(n)&&!profileAlloys.some(a=>normalize(a)===n)),factNumbers};
    const codeValues=unique([p.code,p.manufacturerCode,p.gtin,...(p.externalCodes||[])]).map((x)=>normalize(x).replace(/[^a-z0-9]/g,"")).filter((x)=>x&&/\d/.test(x)&&x.length>=3);
    const tokens=tokenise(main);
    const profile={type,material,materials,alloys:profileAlloys,threads:detectThreads(`${name} ${(p.specs||[]).map(s=>s.value).join(" ")}`),schedule:detectSchedule(`${name} ${(p.specs||[]).map(s=>s.value).join(" ")}`),facts:parsed.facts,numberTokens:parsed.numberTokens,factNumbers:parsed.factNumbers,name,main,family,manufacturer:normalize([p.manufacturer,p.brand,p.productLine].filter(Boolean).join(" ")),supplier:normalize([...(p.supplierLinks||[]).map(s=>s.name),...(p.offers||[]).map(o=>o.supplierName)].join(" ")),codes:codeValues,tokens,tokenSet:new Set(tokens),modelTokens:unique(tokenise(`${p.manufacturerCode||""} ${(p.externalCodes||[]).join(" ")}`).filter(t=>/\d/.test(t)))};
    PROFILE_CACHE.set(p,{signature,profile});return profile;
  }
  function roleWordsFor(type,materials){const set=new Set();for(const [key,aliases] of TYPE_DEFS)if(key===type)aliases.forEach(a=>tokenise(a).forEach(t=>set.add(t)));const wanted=new Set(Array.isArray(materials)?materials:[materials]);for(const [key,aliases] of MATERIAL_DEFS)if(wanted.has(key))aliases.forEach(a=>tokenise(a).forEach(t=>set.add(t)));return set;}
  function interpretQuery(query=""){
    const raw=clean(query),normed=normalize(raw),type=detectType(normed),materials=detectMaterials(normed),material=materials[0]||"",alloys=detectAlloys(normed),threads=detectThreads(normed),schedule=detectSchedule(normed),parsed=parseFacts(raw,[],type),allTokens=tokenise(normed),roles=roleWordsFor(type,materials),notes=[];
    if(/^(?:ch\.?)(?:\s|$)/i.test(raw))notes.push('Interpretando “ch” como “chapa”.');if(/\breg\.?\b/i.test(raw))notes.push('“reg” é ambíguo: pode ser registro, regulador ou outra abreviação. Refine quando necessário.');
    const alloyTokens=new Set(alloys.map(x=>normalize(x))),threadTokens=new Set(threads.flatMap(x=>tokenise(x))),factRaw=new Set(parsed.facts.flatMap(f=>tokenise(f.raw)));
    const modelTokens=unique(allTokens.filter(t=>/^(?=.*[a-z])(?=.*\d)[a-z0-9][a-z0-9./-]{2,}$/.test(t)&&!alloyTokens.has(t)&&!TECHNICAL_WORDS.has(t)&&!factRaw.has(t)));
    const textTokens=allTokens.filter(t=>!roles.has(t)&&!alloyTokens.has(t)&&!threadTokens.has(t)&&!factRaw.has(t)&&!TECHNICAL_WORDS.has(t)&&!/^\d/.test(t));
    const compact=normed.replace(/[^a-z0-9]/g,"");const codeLike=!/\s/.test(normed)&&/^(?=.*\d)[a-z0-9./-]{4,}$/.test(normed);
    const strictCount=(type?1:0)+(material?1:0)+alloys.length+threads.length+(schedule?1:0)+parsed.facts.length+modelTokens.length;
    const ambiguous=!codeLike&&strictCount<2&&textTokens.length<=2;
    if(ambiguous&&raw)notes.push("Busca ampla: escolha a variação correta ou informe medida/código para refinar.");
    const numberTokens=parsed.numberTokens.filter(n=>!parsed.consumedNumbers.includes(n)&&!alloys.some(a=>normalize(a)===n));return {raw,norm:normed,compact,type,material,materials,alloys,threads,schedule,facts:parsed.facts,dimensions:parsed.facts.filter(f=>f.kind==="length").map(f=>({raw:f.raw,value:f.value,unit:"mm",role:f.role})),numberTokens,textTokens,modelTokens,codeLike,ambiguous,specificity:strictCount,notes,technical:detectTechnical(raw)};
  }
  const GENERIC_TYPES=new Set(["conexao","reducao","solda","embalagem","painel"]);
  const TYPE_PARENTS={reducao:"conexao",bucha:"conexao",cotovelo:"conexao",niple:"conexao",valvula:"conexao",uniao:"conexao"};
  function compatibleTypes(q,p){return q===p||TYPE_PARENTS[p]===q||(q==="conexao"&&["tubo","flange"].includes(p))||(q==="solda"&&p==="arame");}
  function alloyCompatible(a,b){const x=String(a).toUpperCase(),y=String(b).toUpperCase();return x===y||(!x.endsWith("L")&&y===`${x}L`);}
  function buildIndex(products){
    const cached=INDEX_CACHE.get(products);if(cached&&cached.length===products.length)return cached.index;const signature=`${products.length}`;
    const df=new Map(),exactNames=new Map(),looseNames=new Map(),exactCodes=new Map();
    for(const p of products){const profile=buildProductProfile(p),set=new Set(profile.tokens);for(const t of set)df.set(t,(df.get(t)||0)+1);if(!exactNames.has(profile.name))exactNames.set(profile.name,[]);exactNames.get(profile.name).push(p);const loose=tokenise(profile.name).join(" ");if(!looseNames.has(loose))looseNames.set(loose,[]);looseNames.get(loose).push(p);for(const code of profile.codes){if(!exactCodes.has(code))exactCodes.set(code,[]);exactCodes.get(code).push(p);}}
    const total=Math.max(1,products.length);const index={df,total,exactNames,looseNames,exactCodes,idf:(t)=>Math.log(1+(total+1)/((df.get(t)||0)+1))};INDEX_CACHE.set(products,{signature,length:products.length,index});return index;
  }
  function lastOfferTime(product){const values=(product.offers||[]).map(o=>Date.parse(o.updatedAt||"")||0);return values.length?Math.max(...values):0;}
  function scoreProduct(product,queryOrIntent,context={}){
    const intent=typeof queryOrIntent==="string"?interpretQuery(queryOrIntent):queryOrIntent,profile=buildProductProfile(product),matches=[],mismatches=[],missing=[];
    if(!intent.raw)return {score:1,tier:1,rejected:false,matches,mismatches,missing,intent,profile};
    const compact=intent.norm.replace(/[^a-z0-9]/g,"");const exactCode=compact.length>=3&&profile.codes.includes(compact);
    if(exactCode&&intent.codeLike)return {score:100000,tier:5,rejected:false,matches:["código exato"],mismatches,missing,intent,profile,exactCode:true};
    if(profile.name===intent.norm)return {score:90000,tier:5,rejected:false,matches:["nome exato"],mismatches,missing,intent,profile};
    if(intent.codeLike){const prefix=profile.codes.some(c=>c.startsWith(compact));return prefix?{score:50000,tier:4,rejected:false,matches:["início do código"],mismatches,missing,intent,profile}:{score:0,tier:0,rejected:true,matches,mismatches:["código não corresponde"],missing,intent,profile};}
    let score=100,contradiction=false,matchedCritical=0,missingCritical=0;
    if(exactCode){score+=30000;matches.push("código exato");matchedCritical++;}
    if(intent.type){if(profile.type&&compatibleTypes(intent.type,profile.type)){score+=profile.type===intent.type?8000:5000;matches.push(`tipo ${TYPE_LABELS[intent.type]||intent.type}`);matchedCritical++;}else if(profile.type){contradiction=true;mismatches.push(`tipo ${TYPE_LABELS[profile.type]||profile.type} diferente`);}else{score-=800;missing.push("tipo não catalogado");missingCritical++;}}
    for(const material of (intent.materials?.length?intent.materials:(intent.material?[intent.material]:[]))){const available=profile.materials?.length?profile.materials:(profile.material?[profile.material]:[]);if(available.includes(material)){score+=4500;matches.push(`material ${material.replace(/_/g," ")}`);matchedCritical++;}else if(available.length){contradiction=true;mismatches.push(`material diferente (${available.join(", ")})`);}else{score-=500;missing.push(`material ${material.replace(/_/g," ")} não catalogado`);missingCritical++;}}
    for(const alloy of intent.alloys){if(profile.alloys.some(x=>alloyCompatible(alloy,x))){score+=5500;matches.push(`liga ${alloy}`);matchedCritical++;}else if(profile.alloys.length){contradiction=true;mismatches.push(`liga diferente (${profile.alloys.join(", ")})`);}else{score-=900;missing.push(`liga ${alloy} não catalogada`);missingCritical++;}}
    for(const thread of intent.threads){if(profile.threads.includes(thread)){score+=4800;matches.push(`rosca ${thread}`);matchedCritical++;}else if(profile.threads.length){contradiction=true;mismatches.push(`rosca diferente (${profile.threads.join(", ")})`);}else{score-=700;missing.push(`rosca ${thread} não catalogada`);missingCritical++;}}
    if(intent.schedule){if(profile.schedule===intent.schedule){score+=4800;matches.push(`SCH ${intent.schedule}`);matchedCritical++;}else if(profile.schedule){contradiction=true;mismatches.push(`schedule diferente (SCH ${profile.schedule})`);}else{score-=700;missing.push(`SCH ${intent.schedule} não catalogado`);missingCritical++;}}
    for(const qf of intent.facts){
      const kindFacts=profile.facts.filter(pf=>pf.kind===qf.kind);
      const exactRole=qf.role?kindFacts.filter(pf=>pf.role===qf.role):[];
      const sameKind=exactRole.length?exactRole:(qf.role?kindFacts.filter(pf=>!pf.role):kindFacts);
      const hit=sameKind.some(pf=>factsEqual(qf,pf));
      if(hit){const weight=["voltage","current","capacitance","pressure","protection","poles","wires","conductors","positions","grade"].includes(qf.kind)?5200:3600;score+=weight;matches.push(`${qf.raw}`);matchedCritical++;}
      else if(sameKind.length){contradiction=true;mismatches.push(`${qf.raw} diferente`);}
      else{score-=600;missing.push(`${qf.raw} não catalogado`);missingCritical++;}
    }
    for(const number of intent.numberTokens){const numericPool=[...(profile.numberTokens||[]),...(profile.factNumbers||[])];const hit=numericPool.includes(number);if(hit){score+=1500;matches.push(`número ${number}`);}else if(numericPool.length&&intent.specificity>=2){contradiction=true;mismatches.push(`número/medida ${number} diferente`);}else{score-=150;}}
    for(const model of intent.modelTokens){const tokenHit=profile.modelTokens.includes(model)||profile.tokens.includes(model)||profile.codes.some(c=>c.includes(model));if(tokenHit){score+=5000;matches.push(`modelo ${model}`);matchedCritical++;}else if(profile.modelTokens.length){contradiction=true;mismatches.push(`modelo ${model} diferente`);}else{score-=500;missing.push(`modelo ${model} não catalogado`);missingCritical++;}}
    if(intent.norm&&phrasePresent(profile.name,intent.norm)){score+=5000;matches.push("frase no nome");}
    let lexicalHits=0;for(const token of intent.textTokens){const idf=context.idf?context.idf(token):1;const w=Math.round(250+350*idf),nameTokens=profile.name.split(" ");if(nameTokens.includes(token)){score+=w*2;matches.push(token);lexicalHits++;}else if(wordPrefixPresent(profile.name,token)){score+=Math.round(w*1.55);matches.push(`${token} no início`);lexicalHits++;}else if(profile.tokenSet.has(token)){score+=w;matches.push(token);lexicalHits++;}else if(token.length>=4&&profile.tokens.some(t=>t.startsWith(token))){score+=Math.round(w*.7);matches.push(`${token} no início`);lexicalHits++;}else{const fuzzy=profile.tokens.find(t=>fuzzyEquals(token,t));if(fuzzy){score+=Math.round(w*0.55);matches.push(`${token}≈${fuzzy}`);lexicalHits++;}else if(profile.manufacturer.includes(token)){score+=120;lexicalHits++;}else if(profile.supplier.includes(token)){score+=25;lexicalHits++;}else score-=Math.round(w*0.25);}}
    if(intent.textTokens.length&&lexicalHits===0&&!matchedCritical)return {score:0,tier:0,rejected:true,matches:unique(matches),mismatches:unique(mismatches),missing:unique(missing),intent,profile};
    if(product.archived)return {score:0,tier:0,rejected:true,matches,mismatches,missing,intent,profile};
    if(matchedCritical===0&&lexicalHits===0)return {score:0,tier:-1,rejected:true,matches:unique(matches),mismatches:unique(mismatches),missing:unique(missing),intent,profile};
    if(contradiction){const related=lexicalHits>0||matchedCritical>0;if(!related)return {score:0,tier:0,rejected:true,matches:unique(matches),mismatches:unique(mismatches),missing:unique(missing),intent,profile};return {score:Math.max(1,Math.min(99,Math.round(score/100))),tier:0,rejected:false,related:true,matches:unique(matches),mismatches:unique(mismatches),missing:unique(missing),intent,profile};}
    const tier=matchedCritical>0&&missingCritical===0?3:(matchedCritical>0?2:(lexicalHits>0?1:-1));score+=tier*10000;score+=Math.min(500,(product.offers||[]).length*5);return {score:Math.max(1,Math.round(score)),tier,rejected:false,related:false,matches:unique(matches),mismatches:unique(mismatches),missing:unique(missing),intent,profile};
  }
  function searchProducts(products,query){
    const list=products||[],intent=interpretQuery(query);
    if(intent.codeLike){
      const compact=intent.compact;
      const exact=list.filter(product=>[product.code,product.manufacturerCode,product.gtin,...(product.externalCodes||[])].some(c=>normalize(c).replace(/[^a-z0-9]/g,"")===compact));
      if(exact.length)return exact.map(product=>({product,score:100000,tier:5,rejected:false,exactCode:true,duplicateCodeCount:exact.length,matches:["código exato"],mismatches:[],missing:[],intent,profile:buildProductProfile(product)})).sort((a,b)=>lastOfferTime(b.product)-lastOfferTime(a.product)||String(a.product.name).localeCompare(String(b.product.name),"pt-BR"));
    }
    const candidates=quickCandidateProducts(list,intent);
    if(candidates.length&&intent.type&&intent.specificity<=1&&!intent.textTokens.length&&!intent.material&&!intent.alloys.length&&!intent.facts.length&&!intent.modelTokens.length)return simpleRankProducts(candidates,intent);
    if(candidates.length&&candidates.length<=180&&intent.specificity>=2&&!intent.facts.length&&!intent.modelTokens.length&&!intent.threads.length&&!intent.schedule)return simpleRankProducts(candidates,intent);
    if(!candidates.length&&intent.raw)return [];
    const working=candidates.length?candidates:list,index=buildIndex(working);
    const exactName=index.exactNames.get(intent.norm)||[];
    if(exactName.length)return exactName.map(product=>({product,score:90000,tier:5,rejected:false,matches:["nome exato"],mismatches:[],missing:[],intent,profile:buildProductProfile(product)})).sort((a,b)=>lastOfferTime(b.product)-lastOfferTime(a.product)||String(a.product.name).localeCompare(String(b.product.name),"pt-BR"));
    const looseName=index.looseNames.get(tokenise(intent.norm).join(" "))||[];
    if(looseName.length)return looseName.map(product=>({product,score:88000,tier:5,rejected:false,matches:["nome equivalente"],mismatches:[],missing:[],intent,profile:buildProductProfile(product)})).sort((a,b)=>lastOfferTime(b.product)-lastOfferTime(a.product)||String(a.product.name).localeCompare(String(b.product.name),"pt-BR"));
    const exactCode=index.exactCodes.get(intent.compact)||[];
    if(exactCode.length&&(intent.codeLike||intent.textTokens.length===0))return exactCode.map(product=>({product,score:100000,tier:5,rejected:false,exactCode:true,duplicateCodeCount:exactCode.length,matches:["código exato"],mismatches:[],missing:[],intent,profile:buildProductProfile(product)})).sort((a,b)=>lastOfferTime(b.product)-lastOfferTime(a.product)||String(a.product.name).localeCompare(String(b.product.name),"pt-BR"));
    const ranked=working.map(product=>({product,...scoreProduct(product,intent,index)})).filter(x=>x.score>0&&!x.rejected),exactCodeCount=ranked.filter(x=>x.exactCode).length;ranked.forEach(x=>{if(x.exactCode)x.duplicateCodeCount=exactCodeCount;});return ranked.sort((a,b)=>b.tier-a.tier||b.score-a.score||lastOfferTime(b.product)-lastOfferTime(a.product)||String(a.product.name).localeCompare(String(b.product.name),"pt-BR"));
  }

  function invalidateProduct(product){if(product&&typeof product==="object"){PROFILE_CACHE.delete(product);QUICK_TEXT_CACHE.delete(product);}}
  function invalidateAll(products){if(Array.isArray(products)){for(const p of products){PROFILE_CACHE.delete(p);QUICK_TEXT_CACHE.delete(p);}INDEX_CACHE.delete(products);}}

  function extractStructuredText(text="",options={}){
    const raw=clean(text),productType=options.productType||detectType(raw),material=detectMaterial(raw),alloys=detectAlloys(raw),threads=detectThreads(raw),schedule=detectSchedule(raw),specs=[];
    const add=(label,value,confidence="alta",evidence="extraído do texto")=>{value=clean(value);if(!value)return;const canonical=canonicalSpecLabel(label);if(!specs.some(s=>normalize(s.label)===normalize(canonical)&&normalize(s.value)===normalize(value)))specs.push({label:canonical,value,confidence,evidence});};
    if(material)add("Material",material==="inox"?"Aço inoxidável":material.replace(/_/g," "));if(alloys.length)add("Liga",alloys.join(" / "));if(threads.length)add("Rosca",threads.join(" / "));if(schedule)add("Schedule",`SCH ${schedule}`);
    const facts=parseFacts(raw,[],productType).facts;for(const f of facts){const label={length:"Medida",area:"Fio / bitola",surface:"Medida",mass:"Capacidade / peso",volume:"Capacidade",voltage:"Tensão",current:"Corrente",capacitance:"Capacitância",frequency:"Frequência",pressure:"Pressão",power:"Potência",speed:"Rotação",protection:"Proteção",poles:"Polos",positions:"Posição",wires:"Fios",conductors:"Condutores",mesh:"Malha",grade:"Grão"}[f.kind];if(label)add(label,f.raw);}
    return {raw,productType,material,alloys,threads,schedule,specs,facts};
  }
  function validateGtin(value=""){const digits=String(value).replace(/\D/g,"");if(![8,12,13,14].includes(digits.length))return false;const body=digits.slice(0,-1).split("").reverse();const sum=body.reduce((n,d,i)=>n+Number(d)*(i%2===0?3:1),0);return (10-(sum%10))%10===Number(digits.at(-1));}
  function stripSourceSuffix(name=""){let s=clean(name).replace(/[™®©]/g,"");s=s.replace(/\s*[|｜]\s*[^|]{2,100}$/,"");s=s.replace(/\s[-–—]\s(?:amazon(?:\.com\.br)?|mercado\s*livre|magazine\s*luiza|loja\s*oficial)\s*$/i,"");return clean(s).replace(/\s*,\s*(?=(?:largura|comprimento|espessura|diâmetro|diametro|altura)\b)/i," — ").replace(/(\d|\")\s*[xX]\s*(?=\d)/g,"$1 × ");}
  function looksLikeSourceTitle(value=""){const s=clean(value);return !!s&&(/^https?:\/\//i.test(s)||/^www\./i.test(s)||(/›|>/.test(s)&&/\.[a-z]{2,}(?:\b|\/)/i.test(s))||/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|\s|$)/i.test(s));}
  function humanNameFromQuery(query="",fallback=""){const intent=interpretQuery(query||fallback||""),parts=[];if(intent.type)parts.push(TYPE_LABELS[intent.type]||intent.type);if(intent.material==="aco_inox")parts.push("aço inox");else if(intent.material)parts.push(intent.material.replace(/_/g," "));(intent.alloys||[]).forEach(a=>{if(!parts.some(p=>normalize(p)===normalize(a)))parts.push(String(a).toUpperCase());});(intent.threads||[]).forEach(t=>parts.push(String(t).toUpperCase()));if(intent.schedule)parts.push(`SCH ${intent.schedule}`);(intent.facts||[]).filter(f=>["length","area","current","voltage","pressure","power","poles","wires","conductors","positions"].includes(f.kind)).slice(0,3).forEach(f=>{if(f.raw)parts.push(f.raw);});if(!parts.length){const words=tokenise(query||fallback||"").filter(t=>!/^(https?|www|com|br|html)$/.test(t)).slice(0,6);if(words.length)parts.push(words.join(" "));}const text=clean(parts.join(" "));return text?text.charAt(0).toUpperCase()+text.slice(1):"";}
  function sourceType(candidate={}){if(candidate.source_type)return candidate.source_type;const host=normalize(candidate.source_name||candidate.url||"").replace(/[^a-z0-9]/g,"");if(MARKETPLACES.some(x=>host.includes(x)))return "marketplace";if(candidate.seller||candidate.supplier)return "retailer";if(candidate.structured&&candidate.manufacturer)return "manufacturer";return "reference";}
  function inferUnit(productType,text="",specs=[]){const n=normalize(`${text} ${(specs||[]).map(s=>`${s.label} ${s.value}`).join(" ")}`);const explicit=[[/\b(?:rolo|bobina)\b/,"rolo"],[/\b(?:caixa|cx)\b/,"cx"],[/\b(?:quilo|kg)\b/,"kg"],[/\b(?:metro quadrado|m2)\b/,"m²"],[/\bpar\b/,"par"],[/\b(?:pacote|pct)\b/,"pct"],[/\bbarra\b/,"barra"],[/\blitro|\blt\b/,"l"]].find(([re])=>re.test(n));if(explicit)return {value:explicit[1],confidence:"alta",evidence:"informado no texto"};const value=UNIT_BY_TYPE[productType]||"un";return {value,confidence:["fita","parafuso","porca","arruela","rebite","rodizio"].includes(productType)?"média":"baixa",evidence:"inferido pelo tipo de material"};}
  function normalizeCandidate(candidate={},query=""){
    const originalRaw=clean(candidate.raw_name||candidate.name||candidate.title||""),fallbackName=humanNameFromQuery(query,`${originalRaw} ${candidate.description||""}`),rawName=looksLikeSourceTitle(originalRaw)?fallbackName:originalRaw,source=sourceType(candidate),parsed=extractStructuredText(`${rawName} ${candidate.description||""}`,{productType:candidate.product_type||candidate.productType});let manufacturer=clean(candidate.manufacturer||""),brand=clean(candidate.product_line||candidate.productLine||candidate.brand_line||"");const suppliedBrand=clean(candidate.brand||"");if(!manufacturer&&suppliedBrand){if(KNOWN_MANUFACTURERS.includes(normalize(suppliedBrand)))manufacturer=suppliedBrand;else brand=suppliedBrand;}if(!manufacturer){const found=KNOWN_MANUFACTURERS.find(m=>phrasePresent(rawName,m));if(found)manufacturer=found==="3m"?"3M":found.toUpperCase();}if(!brand&&/\bscotch\b/i.test(rawName))brand="Scotch";
    const specs=[];const add=(item)=>{const label=canonicalSpecLabel(item.label),value=clean(item.value);if(!value)return;if(!specs.some(x=>normalize(x.label)===normalize(label)&&normalize(x.value)===normalize(value)))specs.push({...item,label,value});};(candidate.specs||candidate.attributes||[]).forEach(s=>add(typeof s==="object"?s:{label:"Característica",value:s}));parsed.specs.forEach(add);
    const productType=candidate.product_type||candidate.productType||parsed.productType||detectType(query),unitInfo=candidate.unit?{value:candidate.unit,confidence:candidate.unit_confidence||"alta",evidence:"informado na fonte"}:inferUnit(productType,rawName,specs),manufacturerCode=clean(candidate.manufacturer_code||candidate.mpn||candidate.model||candidate.sku||""),gtin=clean(candidate.gtin||candidate.ean||candidate.gtin13||"").replace(/\D/g,"");let base=stripSourceSuffix(looksLikeSourceTitle(candidate.canonical_name||candidate.product_name||"")?rawName:(candidate.canonical_name||candidate.product_name||rawName));if(!base||looksLikeSourceTitle(base))base=fallbackName||rawName;if(productType==="fita"&&/silver\s*tape/i.test(rawName))base="Fita Silver Tape";const measure=specs.find(s=>["Medida","Largura","Comprimento","Espessura","Diâmetro"].includes(s.label))?.value||"";const parts=[base];if(brand&&!normalize(base).includes(normalize(brand)))parts.push(brand);if(manufacturer&&!normalize(base).includes(normalize(manufacturer)))parts.push(manufacturer);let canonical=clean(parts.join(" "));if(measure&&!normalize(canonical).includes(normalize(measure)))canonical+=` — ${measure}`;if(looksLikeSourceTitle(canonical))canonical=fallbackName||rawName;const seller=clean(candidate.seller||candidate.supplier||""),supplierSuggestion=["marketplace","retailer","distributor"].includes(source)&&seller?seller:"",fc=candidate.field_confidence||{};
    return {...candidate,raw_name:originalRaw||rawName,name:canonical||rawName,canonical_name:canonical||rawName,display_name:canonical||rawName,manufacturer,brand,product_line:brand,product_type:productType,product_type_label:TYPE_LABELS[productType]||"",manufacturer_code:manufacturerCode,model:manufacturerCode,gtin:gtin&&validateGtin(gtin)?gtin:"",gtin_unverified:gtin&&!validateGtin(gtin)?gtin:"",unit:unitInfo.value,unit_confidence:unitInfo.confidence,unit_evidence:unitInfo.evidence,specs,source_type:source,source_title:originalRaw,source_name:clean(candidate.source_name||candidate.source_host||candidate.source||""),supplier_suggestion:supplierSuggestion,field_confidence:{name:fc.name||"alta",manufacturer:fc.manufacturer||(manufacturer?"média":"baixa"),brand:fc.brand||(brand?"média":"baixa"),product_type:fc.product_type||(productType?"alta":"baixa"),unit:fc.unit||unitInfo.confidence,manufacturer_code:fc.manufacturer_code||(manufacturerCode?"alta":"baixa"),gtin:fc.gtin||(gtin&&validateGtin(gtin)?"alta":"baixa")}};
  }
  function duplicateSimilarity(a={},b={}){const pa=buildProductProfile(a),pb=buildProductProfile(b);if(pa.codes.some(c=>pb.codes.includes(c))&&pa.codes.length&&pb.codes.length)return 1;if(pa.type&&pb.type&&!compatibleTypes(pa.type,pb.type)&&!compatibleTypes(pb.type,pa.type))return 0;if(pa.material&&pb.material&&pa.material!==pb.material)return 0;if(pa.alloys.length&&pb.alloys.length&&!pa.alloys.some(x=>pb.alloys.some(y=>alloyCompatible(x,y))))return 0;let score=0;if(pa.type&&pb.type)score+=.25;if(pa.material&&pb.material)score+=.15;const matches=pa.facts.filter(x=>pb.facts.some(y=>factsEqual(x,y))).length;score+=Math.min(.3,matches*.08);const ta=new Set(pa.tokens),tb=new Set(pb.tokens),union=new Set([...ta,...tb]);score+=union.size?[...ta].filter(x=>tb.has(x)).length/union.size*.3:0;return Math.min(1,score);}

  return {VERSION,clean,cleanUnicode,normalize,tokenise,detectType,detectMaterial,detectMaterials,detectAlloys,detectThreads,detectTechnical,detectSchedule,parseDimensions,parseFacts,extractStructuredText,interpretQuery,buildProductProfile,productSignature,scoreProduct,searchProducts,normalizeCandidate,inferUnit,validateGtin,duplicateSimilarity,TYPE_LABELS,TYPE_DEFS,MATERIAL_DEFS,canonicalSpecLabel,stripSourceSuffix,looksLikeSourceTitle,humanNameFromQuery,factsEqual,invalidateProduct,invalidateAll};
});
