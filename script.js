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
  var tableDeader = "<thead><tr> <th span='1' class='table-col-section'><h4>Section</h4></th>  <th span='1' class='table-col-vo'><h4>Voice</h4></th>  <th span='1' class='table-col-board'><h4>Board</h4></th>  <th span='1' class='table-col-visual'><h4>Shot</h4></th> </tr></thead>"
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
    $.getJSON("http://pvxg.net/BTCpaySponsor/").then(function(data){
       $.each(data, function (key, producer) {
         $( "<div/>", { "class": "producer", html: producer.metadata.itemDesc }).appendTo( "#producers-inner" );
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
