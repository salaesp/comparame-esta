// /api/compartir — el destino de "Compartir" desde otra app (share_target del manifest).
// Lo atiende el service worker (guarda los archivos y abre /?compartido=1); si llega
// hasta acá es que el SW no estaba (la primera vez, o se borró): se vuelve a la app,
// que avisa que no pudo recibir el archivo. No se guarda nada.
export default async function () {
  return new Response(null, { status: 303, headers: { location: '/?compartido=0' } });
}

export const config = { path: '/api/compartir' };
