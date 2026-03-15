import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public class BatExtractionComplexPatternSample {

    public void case01_basicSelect(Connection con) throws SQLException {
        StringBuilder sb = new StringBuilder();
        sb.append(" SELECT ");
        sb.append("   EMP_ID, ");
        sb.append("   EMP_NAME ");
        sb.append(" FROM ");
        sb.append("   EMPLOYEE ");
        sb.append(" WHERE ");
        sb.append("   EMP_ID = ? ");
        PreparedStatement prepareStatement = con.prepareStatement(sb.toString());
        prepareStatement.setString(1, "E001");
    }

    public void case04_appendAfterPrepareOnly(Connection con) throws SQLException {
        StringBuilder sb = new StringBuilder();
        PreparedStatement prepareStatement = con.prepareStatement("SELECT 1 FROM DUAL");
        sb.append(" THIS_APPEND_IS_AFTER_PREPARE ");
        sb.append(" SO_PREVIOUS_BLOCK_SHOULD_NOT_MATCH ");
    }

    public void case13_appendOnOtherObject(Connection con) throws SQLException {
        StringBuilder sb = new StringBuilder();
        StringBuilder logSb = new StringBuilder();

        sb.append(" SELECT ");
        sb.append("   CUSTOMER_ID ");
        sb.append(" FROM ");
        sb.append("   CUSTOMER ");
        sb.append(" WHERE ");
        sb.append("   DELETE_FLG = '0' ");

        logSb.append(" log-start ");
        logSb.append(" log-end ");

        PreparedStatement prepareStatement = con.prepareStatement(sb.toString());
        prepareStatement.setPoolable(false);
    }

    public void case15_commentContainsPreparestatement(Connection con) throws SQLException {
        StringBuilder sb = new StringBuilder();
        sb.append(" SELECT ");
        sb.append("   CODE ");
        sb.append(" FROM ");
        sb.append("   MASTER ");
        // preparestatement is mentioned only in comment
        sb.append(" WHERE ");
        sb.append("   DELETE_FLG = '0' ");

        PreparedStatement prepareStatement = con.prepareStatement(sb.toString());
        prepareStatement.closeOnCompletion();
    }

    public void case19_appendInLambdaLikePattern(Connection con) throws SQLException {
        List<String> list = new ArrayList<>();
        list.add("A");
        list.add("B");

        StringBuilder sb = new StringBuilder();
        sb.append(" SELECT ");
        sb.append("   TEST_COL ");
        sb.append(" FROM ");
        sb.append("   TEST_TABLE ");
        sb.append(" WHERE 1 = 1 ");

        list.forEach(x -> {
            sb.append("   OR TEST_COL = ? ");
        });

        PreparedStatement prepareStatement = con.prepareStatement(sb.toString());
        prepareStatement.setString(1, "A");
    }
}
