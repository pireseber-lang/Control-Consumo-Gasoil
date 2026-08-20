# Control de consumo de gasoil

## Qué construí

Construí una primera versión sencilla de una aplicación web para registrar el consumo de gasoil de un establecimiento agropecuario. Permite subir capturas de un grupo de WhatsApp y busca extraer la fecha, el vehículo y los litros de cada carga. Está pensada para que una persona sin conocimientos técnicos pueda usarla desde el navegador.

## Cómo se lo pedí

Primero pedí construir la aplicación con este prompt:

Quiero construir una aplicación sencilla para controlar el consumo de gasoil de un establecimiento agropecuario. Soy principiante y no quiero escribir código manualmente.

La aplicación debe permitir cargar una o varias capturas de pantalla de un grupo de WhatsApp donde los empleados registran las cargas de gasoil. En esas capturas aparece una foto del caudalímetro del surtidor mostrando los litros cargados y, asociado a esa foto, un mensaje de texto con la patente o identificación del vehículo.

Quiero que la aplicación analice las imágenes e intente extraer de cada carga: fecha, patente o identificación del vehículo y litros cargados.

Luego debe mostrar:

1. Una tabla con Fecha | Vehículo | Litros.
2. Un resumen agrupado por vehículo con cantidad de cargas y litros totales cargados.
3. El total general de litros registrados.

Si algún dato no puede leerse con suficiente seguridad, no debe inventarlo: debe mostrar REVISAR.

Quiero una interfaz muy sencilla que pueda usar desde el navegador, donde pueda subir las capturas y ver el resultado.

Construí una primera versión funcional dentro de este proyecto. Elegí vos la solución técnica más simple posible. Antes de terminar, verificá que la aplicación pueda ejecutarse y explicame en lenguaje sencillo qué creaste y cómo puedo probarla. No agregues funciones que no te pedí.

Cuando el servidor local se detuvo, pedí volver a iniciarlo:

Volvé a iniciar la aplicación local para que pueda continuar probándola con mis capturas reales. No hagas ningún cambio en la aplicación.

Después de la primera prueba real, pedí un diagnóstico antes de autorizar cambios:

Probé la aplicación con una captura real del grupo de WhatsApp y no pudo extraer los datos. La captura contiene dos cargas de gasoil del mismo día. La aplicación mostró un solo registro y marcó fecha, vehículo y litros como REVISAR.
Quiero mantener esta primera versión simple. Analizá por qué falló con una captura real de WhatsApp y proponeme el cambio mínimo necesario para que pueda detectar más de una carga dentro de una misma captura y extraer fecha, vehículo y litros. No hagas ningún cambio todavía: primero explicame qué encontraste y qué proponés modificar.

Finalmente autoricé una única iteración:

Autorizo ese cambio mínimo. Implementalo manteniendo el alcance actual de la aplicación. No agregues nuevas funcionalidades. Usá la captura real que probamos como caso de prueba y verificá específicamente que pueda generar más de un registro a partir de una misma captura. Mantené la regla de marcar REVISAR cuando algún dato no pueda determinarse con suficiente seguridad.

## Qué funciona

La aplicación funciona localmente desde el navegador. Para usarla hay que subir una o varias capturas y presionar “Analizar capturas”. Luego muestra el detalle de las cargas, el resumen por vehículo y el total de litros considerados seguros.

En la prueba final con una captura real de WhatsApp pudo generar dos registros a partir de la misma imagen. Detectó correctamente la fecha 11/08/2026 y los vehículos AG 726 YE y ORW 275. También leyó correctamente 56 litros para ORW 275.

La regla de seguridad funciona: cuando un dato no puede determinarse con suficiente confianza, la aplicación muestra REVISAR y no lo incluye en la suma de litros seguros. Por eso, en la prueba final el total general mostrado fue de 56 litros.

## Qué falta o qué falló

La primera versión suponía erróneamente que cada captura contenía una sola carga. En la primera prueba real encontró un único registro y mostró REVISAR en la fecha, el vehículo y los litros, aunque la captura contenía dos cargas.

Antes de modificar la aplicación se hizo un diagnóstico. Se encontró que el análisis procesaba toda la captura como una sola unidad y que la confianza global del reconocimiento era baja, aunque algunas partes de la imagen sí eran legibles. Se hizo una única iteración para separar los bloques asociados a cada vehículo y analizar de forma individual las zonas de los caudalímetros.

La iteración permitió detectar las dos cargas, pero la lectura de 60 litros correspondiente a AG 726 YE todavía quedó como REVISAR. La aplicación no inventó ese valor ni lo sumó al total seguro. Esto muestra que sigue siendo una primera versión y que el reconocimiento puede fallar según la calidad, el tamaño o el contraste de la foto.

Durante el desarrollo también hubo demoras y cortes de red al instalar dependencias y una demora prolongada al configurar Tesseract OCR en español. La publicación privada presentó problemas de acceso, mientras que la aplicación local sí funcionó. Además, al cerrarse Codex se detuvo el servidor local y fue necesario volver a iniciarlo para continuar las pruebas.

## Qué aprendí

Aprendí que una primera versión debe probarse con casos reales porque las suposiciones iniciales pueden ser incorrectas.  
Entendí que conviene pedir un diagnóstico antes de autorizar cambios, para mantener la solución dentro del alcance original.  
También aprendí que un agente puede construir e iterar una aplicación a partir de instrucciones, pero sigue siendo necesario probar y revisar sus resultados.  
No escribí código manualmente: describí lo que necesitaba, probé la aplicación y fui tomando decisiones junto con Codex.
