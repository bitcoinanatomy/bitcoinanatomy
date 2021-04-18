// BTCPay Server
if(!window.btcpay){
  var head = document.getElementsByTagName('head')[0];   var script = document.createElement('script');
  script.src='https://btcpay989117.lndyn.com/modal/btcpay.js';
  script.type = 'text/javascript';
  head.append(script);}function onBTCPayFormSubmit(event){
    var xhttp = new XMLHttpRequest();    xhttp.onreadystatechange = function() {
      if (this.readyState == 4 && this.status == 200) {
      if(this.status == 200 && this.responseText){
        var response = JSON.parse(this.responseText);
        window.btcpay.showInvoice(response.invoiceId);
      }
    }
  };
      xhttp.open("POST", event.target.getAttribute('action'), true);
      xhttp.send(new FormData( event.target ));
}





$( document ).ready(function() {


    $("#hero-cta").click(function() {
      $('html, body').animate({
          scrollTop: $("#producership-options ").offset().top
      }, 1000);
    });


    $("#back-to-scenes").click(function() {
      $('html, body').animate({
          scrollTop: $("#scenes").offset().top
      }, 1000);
    });



    $(".popup-toggle").click(function() {
      $("#"+$(this).attr("data-target")).fadeIn(300);
    });

    $(".popup-overlay").click(function(event) {
      e = event || window.event;
      if (e.target == this) {
        $("#"+$(this).attr("data-target")).fadeOut(300);
      }
    });

    $(".popup-close").click(function() {
      $(".popup-overlay").fadeOut(300);
      $('iframe').attr('src', $('iframe').attr('src'));
    });





  //load scenes from google docs
  var totalScenes = 9;
  var sceneData = [];
  var shots = [];
  var tableDeader = "<thead><tr> <th span='1' class='table-col-section'><h4>Theme</h4></th>  <th span='1' class='table-col-vo'><h4>Voice</h4></th>  <th span='1' class='table-col-board'><h4>Board</h4></th>  <th span='1' class='table-col-visual'><h4>Shot</h4></th> </tr></thead>"
  //and in your call will listen for the custom deferred's done
  for (i = 1; i <= totalScenes; i++) {
    getGoogleSheetData(i).then(function(returndata){
      sceneData.push(returndata);
      //if all loaded
      if(sceneData.length == totalScenes){
        //sort after all loaded
        sceneData.sort(compare);
        //iterate all scenes
        $.each(sceneData, function( key, scene ) {
            //print title nav
            $( "<h4/>", { "id": "scene-select-"+scene.sort, "class": "scene-select inactive", html: scene.title }).appendTo( "#scenes-nav" );
            shots.push(tableDeader);
            shots.push("<tbody>");
            $.each( scene.shots, function( key, shot ) {
              //console.log(shot);
              shots.push( "<tr id='sheet"+scene.sort+" row-" + key + "'> ");
                shots.push( "<td span='1' class='table-col-section'><h4>" + shot.gsx$section.$t + "</h4></td>");
                shots.push( "<td span='1' class='table-col-vo'>" + shot.gsx$vo.$t + "</td>");
                shots.push( "<td span='1' class='table-col-board'>");
                if(shot.gsx$board.$t != ""){
                  shots.push( "<div class='image-holder'><img src=" + shot.gsx$board.$t + " /></div>");
                }
                shots.push( "</td>");
                shots.push( "<td span='1' class='table-col-visual grey'>" + shot.gsx$visual.$t + "</td>");
              shots.push( "</tr>");
            });
            shots.push("</tbody>");

            //Print shots table
            $( "<table/>", { "id": "scene-select-"+scene.sort+"-table" , "class": "scene", html: shots.join( "" ) }).appendTo( "#scenes-data" );

            shots = [];
        });



        $('.scene-select').click(function() {
          var t = $(this).attr('id');

          if($(this).hasClass('inactive')){ //this is the start of our condition
            $('.scene-select').addClass('inactive');
            $(this).removeClass('inactive');

            $('.scene').hide();
            $('#'+ t + '-table').fadeIn('slow');
         }

         for (i = 1; i <= totalScenes; i++) {
            $('#scenes-diagrams').removeClass('diagram-scene-select-'+i);
         }
         $('#scenes-diagrams').addClass('diagram-'+t);

        });

        $('.scene').hide();
        $('#scene-select-1-table').fadeIn('slow');
        $('#scene-select-1').removeClass('inactive');


      }
    });
  }




  getProducerData();



  $(".btcpay-form").each(function( index, element ) {
    var jsonForm = new Object();
    var type = $(element).find('.input-checkoutDesc').val();
    $(element).find('.btcpay-input').keyup(function() {

      // limit, for validation
      // {"p":"Contributor","n":"wdhgt735344eew","t":"rwfrw66uiolou3746467456fwwed","g":"546646665644664654"}
      $(element).find('.input-checkoutDesc').val( type + ':' + $(element).find('.input-name').val());
      jsonForm.p = type;
      jsonForm.n = $(element).find('.input-name').val();
      jsonForm.t = $(element).find('.input-twitterHandle').val();
      jsonForm.g = $(element).find('.input-githubUsername').val();
      console.log(JSON.stringify(jsonForm));
      $(element).find('.input-orderId').val(JSON.stringify(jsonForm));
    });

  });


});



















function getGoogleSheetData(i){
    return $.getJSON("https://spreadsheets.google.com/feeds/list/1JTdEbmcEsAtAz1-FyO9LyxF-FsBwEJ-9MCthfWktfv8/"+(i+1)+"/public/values?alt=json").then(function(data){
      return {
        sort:i,
        title:data.feed.title.$t,
        shots:data.feed.entry
      }
    });
};


function getProducerData(){
    $.getJSON("https://pvxg.net/BTCpaySponsor/").then(function(data){
       $.each(data, function (key, producer) {
         //console.log(JSON.parse(producer.metadata.orderId));
         console.log(producer.metadata.itemDesc.startsWith("Contributor:"));

         var targetContainer = "";
         if(producer.metadata.itemDesc.startsWith("Contributor:")){
           targetContainer = "#contributors-inner";
           $( "<b/>", { "class": "producer-name", html: producer.metadata.itemDesc }).appendTo(targetContainer);
         } else if(producer.metadata.itemDesc.startsWith("Sponsor:")){
           targetContainer = "#sponsors-inner";
           $( "<h2/>", { "class": "producer-name", html: producer.metadata.itemDesc }).appendTo(targetContainer);
         } else if(producer.metadata.itemDesc.startsWith("Producer:")){
           targetContainer = "#producers-inner";

           //Adding logos to major contributors
           if(producer.metadata.itemDesc.startsWith("Producer:ACME")){
             $( "<div/>", { "class": "producer-logo", html: '<img src="assets/logos/example.png">' }).appendTo(targetContainer);
           }

           //$( "<h4/>", { "class": "producer-name", html: producer.metadata.itemDesc }).appendTo(targetContainer);
         }





           //$( "<div/>", { "class": "producer-title", html: producer.metadata.orderId }).appendTo(targetContainer);
           $( "<div/>", { "class": "producer-amount", html: producer.amount + ' <span class="grey">' + producer.currency + '</span>' }).appendTo(targetContainer);

          //reset target
          targetContainer = "";
       });
    });
};




function compare( a, b ) {
  if ( a.sort < b.sort ){
    return -1;
  }
  if ( a.sort > b.sort ){
    return 1;
  }
  return 0;
}
