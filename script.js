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


    $(document).on('keyup', function(e) {
      if (e.key == "Escape") {
        $(".popup-overlay").fadeOut(300);
        $('iframe').attr('src', $('iframe').attr('src'));
      };
    });






  //load scenes from google docs
  var totalScenes = 9;



  // Hack to force reloading of content from google sheets
  setTimeout(function(){
    getScenesData(totalScenes);
    getProducerData();
    getTeamtData(totalScenes);
  }, 500);



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

  // Form label animations
  $('input').focus(function(){
    $(this).parents('.form-group').addClass('focused');
  });
  $('input').blur(function(){
    var inputValue = $(this).val();
    if ( inputValue == "" ) {
      $(this).removeClass('filled');
      $(this).parents('.form-group').removeClass('focused');
    } else {
      $(this).addClass('filled');
    }
  })


});










function getScenesData(totalScenes){

  var sceneData = [];
  var shots = [];
  var tableDeader = "<thead><tr> <th class='table-col-section'><h4>Theme</h4></th>   <th class='table-col-board'><h4>Board</h4></th>  <th class='table-col-vo'><h4>Voice</h4></th>  <th class='table-col-visual'><h4>Shot</h4></th> </tr></thead>"
  //and in your call will listen for the custom deferred's done
  for (i = 1; i <= totalScenes; i++) {
    getScriptData(i).then(function(returndata){
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
              shots.push( "<tr id='sheet"+scene.sort+" row-" + key + "' class='row-content'> ");
                var rowContent = '';
                shot.gsx$section.$t == '' ? rowContent = ' empty' : rowContent = '';
                shots.push( "<td class='table-col-section"+rowContent+"'><h4>" + shot.gsx$section.$t.replace(/\n/g,"<br>") + "</h4></td>");

                shot.gsx$board.$t == '' ? rowContent = ' empty' : rowContent = '';
                shots.push( "<td class='table-col-board"+rowContent+"'>");
                if(shot.gsx$board.$t != ""){
                  shots.push( "<div class='image-holder'><img src=" + shot.gsx$board.$t + " /></div>");
                }
                shots.push( "</td>");


                shot.gsx$vo.$t == '' ? rowContent = ' empty' : rowContent = '';
                shots.push( "<td class='table-col-vo"+rowContent+"'>" + shot.gsx$vo.$t.replace(/\n/g,"<br>") + "</td>");


                shot.gsx$visual.$t == '' ? rowContent = ' empty' : rowContent = '';
                shots.push( "<td class='table-col-visual grey"+rowContent+"'>" + shot.gsx$visual.$t.replace(/\n/g,"<br>") + "</td>");
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
}








function getTeamtData(totalScenes){
    var teamData = {};
    var markupTeam = '';
    var department;
    return $.getJSON("https://spreadsheets.google.com/feeds/list/1JTdEbmcEsAtAz1-FyO9LyxF-FsBwEJ-9MCthfWktfv8/"+(totalScenes+2)+"/public/values?alt=json").then(function(data){

      $.each(data.feed.entry, function (key, teamMember) {
        if(teamMember.gsx$department.$t !== ""){
              department = teamMember.gsx$department.$t;
              teamData[department] = {'departmentName': department, 'departmentCompensation': teamMember.gsx$departmentcompensation.$t, 'team': [] };
        }
        teamData[department].team.push({
          'name': teamMember.gsx$individual.$t.replace(/\n/g,"<br>"),
          'individualCompensation': teamMember.gsx$individualcompensation.$t,
          'url': teamMember.gsx$url.$t
        })

      });


      $.each(teamData, function(key, item){

        $.each(item.team, function(key, teamMember){

          if(teamMember.url != ""){
            markupTeam += '<a href="'+teamMember.url+'" target="_blank">' + teamMember.name + '</a> <span class="compensation">' + teamMember.individualCompensation + '%</span><br>';
          }else{
            markupTeam += teamMember.name + ' <span class="compensation">' + teamMember.individualCompensation + '%</span><br>';
          }
        });


        $('#team-data').append('<tr><td class="team-position"><span class="compensation">'+item.departmentCompensation+'%</span> '+item.departmentName+' </td><td class="team-person">'+markupTeam+'</td></tr>');
        markupTeam = "";
      });



    });

};

/*
gsx$individualcompensation
gsx$departmentcompensation
gsx$individual
gsx$url
*/





function getScriptData(i){
    return $.getJSON("https://spreadsheets.google.com/feeds/list/1JTdEbmcEsAtAz1-FyO9LyxF-FsBwEJ-9MCthfWktfv8/"+(i+1)+"/public/values?alt=json").then(function(data){
      return {
        sort:i,
        title:data.feed.title.$t,
        shots:data.feed.entry
      }
    });
};






function getProducerData(){

    var amoutTotal = 0;

    $.getJSON("https://pvxg.net/BTCpaySponsor/").then(function(data){
       $.each(data, function (key, producer) {
         //console.log(JSON.parse(producer.metadata.orderId));
         //console.log(producer.metadata.itemDesc.startsWith("Contributor:"));

         var targetContainer = "";
         var jsonObject;
         var amount = '<div class="amount">' + producer.amount + ' <span class="grey">' + producer.currency + '</span></div>';
         var currentAmount = parseFloat(producer.amount);



         if(producer.metadata.itemDesc !== undefined && producer.metadata.itemDesc !== null){

                 if(producer.metadata.itemDesc.startsWith("Contributor:")){

                     targetContainer = "#contributors-inner";
                     jsonObject = JSON.parse(producer.metadata.orderId);
                     //console.log(jsonObject.n);
                     $( "<div/>", { "class": "producer-name", html: '<b>' + jsonObject.n + '</b>' + amount }).appendTo(targetContainer);

                     amoutTotal = (currentAmount) + amoutTotal;

                 } else if(producer.metadata.itemDesc.startsWith("Sponsor:")){

                     targetContainer = "#sponsors-inner";
                     jsonObject = JSON.parse(producer.metadata.orderId);
                     $( "<div/>", { "class": "producer-name", html:  '<h2>' + jsonObject.n + '</h2>' + amount }).appendTo(targetContainer);

                     amoutTotal = (currentAmount) + amoutTotal;

                 } else if(producer.metadata.itemDesc.startsWith("Producer:")){

                     targetContainer = "#producers-inner";
                     //Adding logos to major contributors
                     if(producer.metadata.itemDesc.startsWith("Producer:ACME")){
                       $( "<div/>", { "class": "producer-name", html: '<img class="producer-logo" src="assets/logos/example.png">' + amount }).appendTo(targetContainer);
                     }
                     if(producer.metadata.itemDesc.startsWith("Producer:Widgets")){
                       $( "<div/>", { "class": "producer-name", html: '<img class="producer-logo" src="https://theme4press.com/wp-content/uploads/2015/11/featured-large-adding-widgets.jpg">' + amount }).appendTo(targetContainer);
                     }

                     amoutTotal = (currentAmount) + amoutTotal;


                 }
         }
         //reset target
         targetContainer = "";
       });

       var finalProgress = (amoutTotal / 5)*100
       if( finalProgress < 3 ){
         finalProgress = '30px';
         $('.meter').addClass('short');
       }else{
         $('.meter').addClass('long');
         finalProgress = finalProgress+'%';
       }
       $(".amount-value-progress").text(amoutTotal.toFixed(8));
       $( "#meter-progress-bar" ).animate({ width: finalProgress}, 200, function() { });
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
